import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SupabaseService } from '../../../core/supabase/supabase.service';
import { AuthService } from '../../../core/auth/auth.service';

// Audio quality knobs — tweak here and the worklet + encoder pick it up.
const SEGMENT_SECONDS = 10;
const REQUESTED_CHANNELS = 2;       // stereo when the mic supports it, mono otherwise
const BIT_DEPTH: 16 | 24 = 16;      // 24 = audiophile, doubles file size
const DISABLE_VOICE_DSP = true;     // turn off echoCancellation/noiseSuppression/AGC

const WORKLET_PROCESSOR = `
  class RecorderProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const input = inputs[0];
      if (!input || input.length === 0 || !input[0]) return true;
      const channels = input.length;
      const frames = input[0].length;
      const out = new Float32Array(channels * frames);
      for (let f = 0; f < frames; f++) {
        for (let c = 0; c < channels; c++) {
          out[f * channels + c] = input[c][f];
        }
      }
      this.port.postMessage({ samples: out, channels });
      return true;
    }
  }
  registerProcessor('recorder-processor', RecorderProcessor);
`;

interface SampleMessage {
  samples: Float32Array;
  channels: number;
}

@Injectable({ providedIn: 'root' })
export class RecordingService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  private readonly _isRecording = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _segmentsUploaded = signal(0);
  private readonly _segmentsPending = signal(0);
  private readonly _sessionPrefix = signal<string | null>(null);

  readonly isRecording = this._isRecording.asReadonly();
  readonly error = this._error.asReadonly();
  readonly segmentsUploaded = this._segmentsUploaded.asReadonly();
  readonly segmentsPending = this._segmentsPending.asReadonly();
  readonly sessionPrefix = this._sessionPrefix.asReadonly();

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;

  private buffer: Float32Array[] = [];
  private bufferedFrames = 0;
  private numChannels = 1;
  private sampleRate = 44100;
  private segmentFrames = 0;
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
      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: REQUESTED_CHANNELS },
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 24 },
        echoCancellation: !DISABLE_VOICE_DSP,
        noiseSuppression: !DISABLE_VOICE_DSP,
        autoGainControl: !DISABLE_VOICE_DSP,
      };

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      const track = this.stream.getAudioTracks()[0];
      const settings = track?.getSettings?.();
      if (settings) {
        // Surface the negotiated settings so you can tell what the browser actually gave you.
        // eslint-disable-next-line no-console
        console.info('[recording] track settings', settings);
      }

      const AudioCtxCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new AudioCtxCtor({
        latencyHint: 'playback',
        sampleRate: settings?.sampleRate,
      });
      this.sampleRate = this.audioCtx.sampleRate;
      this.segmentFrames = Math.round(this.sampleRate * SEGMENT_SECONDS);

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
      this.worklet = new AudioWorkletNode(this.audioCtx, 'recorder-processor', {
        channelCount: REQUESTED_CHANNELS,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.worklet.port.onmessage = (event: MessageEvent<SampleMessage>) => {
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

    try {
      this.source?.disconnect();
      this.worklet?.disconnect();
    } catch {
      // Ignore — cleanup below resets state regardless.
    }

    if (this.bufferedFrames > 0) {
      const remaining = this.takeFrames(this.bufferedFrames);
      this.enqueueSegment(remaining);
    }

    await this.cleanup();
    this._isRecording.set(false);
  }

  private onSamples({ samples, channels }: SampleMessage): void {
    this.numChannels = channels;
    this.buffer.push(samples);
    this.bufferedFrames += samples.length / channels;

    while (this.bufferedFrames >= this.segmentFrames) {
      const segment = this.takeFrames(this.segmentFrames);
      this.enqueueSegment(segment);
    }
  }

  private takeFrames(frameCount: number): Float32Array {
    const interleavedCount = frameCount * this.numChannels;
    const out = new Float32Array(interleavedCount);
    let filled = 0;
    while (filled < interleavedCount && this.buffer.length > 0) {
      const first = this.buffer[0];
      const needed = interleavedCount - filled;
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
    this.bufferedFrames -= filled / this.numChannels;
    return out;
  }

  private enqueueSegment(interleaved: Float32Array): void {
    if (interleaved.length === 0) return;
    const index = this.segmentIndex++;
    const blob = encodeWav(
      interleaved,
      this.sampleRate,
      this.numChannels,
      BIT_DEPTH,
    );
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
    this.bufferedFrames = 0;
    this.numChannels = 1;
    this.segmentIndex = 0;
    this.uploadQueue = [];
    this._segmentsUploaded.set(0);
    this._segmentsPending.set(0);
    this.currentUserId = userId;
    this.currentSessionId = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');
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

function encodeWav(
  interleaved: Float32Array,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: 16 | 24,
): Blob {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = interleaved.length * bytesPerSample;
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
  if (bitsPerSample === 16) {
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      const clamped = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
    }
  } else {
    for (let i = 0; i < interleaved.length; i++, offset += 3) {
      const clamped = Math.max(-1, Math.min(1, interleaved[i]));
      const signed = Math.round(clamped * 0x7fffff);
      const unsigned = signed < 0 ? signed + 0x1000000 : signed;
      view.setUint8(offset, unsigned & 0xff);
      view.setUint8(offset + 1, (unsigned >> 8) & 0xff);
      view.setUint8(offset + 2, (unsigned >> 16) & 0xff);
    }
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
