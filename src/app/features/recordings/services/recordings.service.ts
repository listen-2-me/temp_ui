import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import {
  StorageEntry,
  SupabaseService,
} from '../../../core/supabase/supabase.service';

export type TranscriptionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | string;

export interface TranscriptionResult {
  storage_events_id: string;
  transcription: string;
  status: TranscriptionStatus;
}

export interface RecordingFile {
  name: string;
  path: string;
  size: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RecordingSession {
  sessionId: string;
  path: string;
  files: RecordingFile[];
  totalSize: number;
  latestAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class RecordingsService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl;

  private readonly _sessions = signal<RecordingSession[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly sessions = this._sessions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  async refresh(): Promise<void> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const userId = await this.resolveUserId();
      if (!userId) {
        throw new Error('Could not determine the signed-in user.');
      }

      const entries = await this.supabase.listFolder(userId);
      // Folder entries returned by Supabase have id === null.
      const sessionFolders = entries.filter(entry => entry.id === null);

      const sessions: RecordingSession[] = [];
      for (const folder of sessionFolders) {
        const sessionPath = `${userId}/${folder.name}`;
        const files = await this.supabase.listFolder(sessionPath);
        const wavs: RecordingFile[] = files
          .filter(f => f.id !== null && f.name.endsWith('.wav'))
          .map(f => {
            const size =
              typeof f.metadata?.['size'] === 'number'
                ? (f.metadata['size'] as number)
                : 0;
            return {
              name: f.name,
              path: `${sessionPath}/${f.name}`,
              size,
              createdAt: f.created_at ?? null,
              updatedAt: f.updated_at ?? null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        if (wavs.length === 0) continue;

        const totalSize = wavs.reduce((sum, f) => sum + f.size, 0);
        const latestAt = wavs
          .map(f => f.updatedAt ?? f.createdAt)
          .filter((v): v is string => !!v)
          .sort()
          .at(-1) ?? null;

        sessions.push({
          sessionId: folder.name,
          path: sessionPath,
          files: wavs,
          totalSize,
          latestAt,
        });
      }

      sessions.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
      this._sessions.set(sessions);
    } catch (err) {
      this._error.set(describeError(err));
      this._sessions.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  publicUrl(path: string): string {
    return this.supabase.getPublicUrl(path);
  }

  async fetchTranscription(
    sessionId: string,
    segmentName: string,
  ): Promise<TranscriptionResult | null> {
    const userId = await this.resolveUserId();
    if (!userId) return null;
    const params = new URLSearchParams({
      user_id: userId,
      session_id: sessionId,
      segment_name: segmentName,
    });
    try {
      return await firstValueFrom(
        this.http.get<TranscriptionResult>(
          `${this.apiBase}/transcriptions?${params.toString()}`,
        ),
      );
    } catch {
      return null;
    }
  }

  private async resolveUserId(): Promise<string | null> {
    const current = this.auth.user();
    if (current?.id) return String(current.id);
    if (current?.phoneNumber) return sanitize(current.phoneNumber);
    try {
      const user = await firstValueFrom(this.auth.fetchMe());
      if (user?.id) return String(user.id);
      if (user?.phoneNumber) return sanitize(user.phoneNumber);
    } catch {
      // fall through — caller reports the error.
    }
    return null;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return err instanceof Error ? err.message : 'Failed to load recordings.';
}
