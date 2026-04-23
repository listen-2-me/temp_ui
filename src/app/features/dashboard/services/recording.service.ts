import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SupabaseService } from '../../../core/supabase/supabase.service';
import { AuthService } from '../../../core/auth/auth.service';

const WORKLET_PROCESSOR = `
  class RecorderProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const input = inputs[0];
      if (input && input[0]) {
        this.port.postMessage(input[0].slice(0));
      }
      return true;
    }
  }
  registerProcessor('recorder-processor', RecorderProcessor);
`;

const SEGMENT_SECONDS = 10;

@Injectable({ providedIn: 'root' })
export class RecordingService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  private readonly _isRecording = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _segmentsUploaded = signal(0);
  private readonly _segmentsPending = signal(0);
  private readonly _sessionId = signal<string | null>(null);
  private readonly _sessionPrefix = signal<string | null>(null);

  readonly isRecording = this._isRecording.asReadonly();
  readonly error = this._error.asReadonly();
  readonly segmentsUploaded = this._segmentsUploaded.asReadonly();
  readonly segmentsPending = this._segmentsPending.asReadonly();
  readonly sessionId = this._sessionId.asReadonly();
  readonly sessionPrefix = this._sessionPrefix.asReadonly();

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;

  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private sampleRate = 44100;
  private segmentSamples = 0;
  private segmentIndex = 0;
  private currentSessionId = '';
  private currentUserId = '';

  private uploadQueue: Array<{ path: string; blob: Blob }> = [];
  private isDraining = false;

  async toggle(): Promise<void> {
    if (this._isRecording()) {
      await this.stop();
    } else {
      await this.start();
    }
  }

  async start(): Promise<void> {
    this._error.set(null);

    if (!this.supabase.isConfigured) {
      this._error.set(
        'Supabase is not configured. Fill in supabaseUrl and supabaseAnonKey in environment.ts.',
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this._error.set('Microphone API is not available in this browser.');
      return;
    }

    const userId = await this.resolveUserId();
    if (!userId) {
      this._error.set('Could not determine the signed-in user. Please sign in again.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtxCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new AudioCtxCtor();
      this.sampleRate = this.audioCtx.sampleRate;
      this.segmentSamples = Math.round(this.sampleRate * SEGMENT_SECONDS);

      const blob = new Blob([WORKLET_PROCESSOR], {
        type: 'application/javascript',
      });
      const url = URL.createObjectURL(blob);
      try {
        await this.audioCtx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      this.resetSession(userId);

      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.audioCtx, 'recorder-processor');
      this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        this.onSamples(event.data);
      };
      this.source.connect(this.worklet);

      this._isRecording.set(true);
    } catch (err) {
      this._error.set(this.describeError(err));
      await this.cleanup();
      this._isRecording.set(false);
    }
  }

  async stop(): Promise<void> {
    if (!this._isRecording()) return;

    // Disconnect the audio graph so no more samples arrive, then flush any
    // leftover audio that hasn't hit the 10s boundary as a final segment.
    try {
      this.source?.disconnect();
      this.worklet?.disconnect();
    } catch {
      // Ignore — cleanup below resets state regardless.
    }

    if (this.bufferedSamples > 0) {
      const remaining = this.takeSamples(this.bufferedSamples);
      this.enqueueSegment(remaining);
    }

    await this.cleanup();
    this._isRecording.set(false);
  }

  private onSamples(chunk: Float32Array): void {
    this.buffer.push(chunk);
    this.bufferedSamples += chunk.length;

    while (this.bufferedSamples >= this.segmentSamples) {
      const segment = this.takeSamples(this.segmentSamples);
      this.enqueueSegment(segment);
    }
  }

  private takeSamples(count: number): Float32Array {
    const out = new Float32Array(count);
    let filled = 0;
    while (filled < count && this.buffer.length > 0) {
      const first = this.buffer[0];
      const needed = count - filled;
      if (first.length <= needed) {
        out.set(first, filled);
        filled += first.length;
        this.buffer.shift();
      } else {
        out.set(first.subarray(0, needed), filled);
        this.buffer[0] = first.subarray(needed);
        filled += needed;
      }
    }
    this.bufferedSamples -= filled;
    return out;
  }

  private enqueueSegment(samples: Float32Array): void {
    if (samples.length === 0) return;
    const index = this.segmentIndex++;
    const blob = encodeWav(samples, this.sampleRate);
    const path = `${this.currentUserId}/${this.currentSessionId}/segment-${String(index).padStart(4, '0')}.wav`;
    this.uploadQueue.push({ path, blob });
    this._segmentsPending.update(n => n + 1);
    void this.drainUploadQueue();
  }

  private async drainUploadQueue(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      while (this.uploadQueue.length > 0) {
        const job = this.uploadQueue[0];
        try {
          await this.supabase.uploadRecording(job.path, job.blob);
          this.uploadQueue.shift();
          this._segmentsPending.update(n => Math.max(0, n - 1));
          this._segmentsUploaded.update(n => n + 1);
        } catch (err) {
          this._error.set(
            `Upload failed for ${job.path}: ${this.describeError(err)}`,
          );
          // Drop the failed segment so the queue doesn't stall forever.
          this.uploadQueue.shift();
          this._segmentsPending.update(n => Math.max(0, n - 1));
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  private resetSession(userId: string): void {
    this.buffer = [];
    this.bufferedSamples = 0;
    this.segmentIndex = 0;
    this.uploadQueue = [];
    this._segmentsUploaded.set(0);
    this._segmentsPending.set(0);
    this.currentUserId = userId;
    this.currentSessionId = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');
    this._sessionId.set(this.currentSessionId);
    this._sessionPrefix.set(`${userId}/${this.currentSessionId}`);
  }

  private async resolveUserId(): Promise<string | null> {
    const existing = this.auth.user();
    if (existing?.id) return String(existing.id);
    if (existing?.phoneNumber) return sanitize(existing.phoneNumber);
    try {
      const user = await firstValueFrom(this.auth.fetchMe());
      if (user?.id) return String(user.id);
      if (user?.phoneNumber) return sanitize(user.phoneNumber);
    } catch {
      // fall through — return null so caller can surface an error.
    }
    return null;
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        await this.audioCtx.close();
      }
      this.stream?.getTracks().forEach(track => track.stop());
    } catch {
      // Teardown errors are non-fatal.
    }
    this.stream = null;
    this.audioCtx = null;
    this.source = null;
    this.worklet = null;
  }

  private describeError(err: unknown): string {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        return 'Microphone access was denied. Enable it in your browser settings.';
      }
      if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        return 'No microphone was found on this device.';
      }
    }
    if (typeof err === 'object' && err !== null && 'message' in err) {
      return String((err as { message: unknown }).message);
    }
    return err instanceof Error ? err.message : 'Recording failed.';
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
