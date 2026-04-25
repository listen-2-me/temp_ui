import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

const STORAGE_KEY = 'listen2me.chat.messages';
const DEFAULT_LIMIT = 10;

export type ChatRole = 'user' | 'assistant';

export interface ChatMatch {
  transcription: string;
  createdAt?: string;
  similarityScore?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  matches?: ChatMatch[];
  error?: boolean;
}

interface SearchMatch {
  transcription?: unknown;
  createdAt?: unknown;
  similarityScore?: unknown;
}

interface SearchResponse {
  answer?: string;
  matches?: SearchMatch[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiBaseUrl;

  private readonly _messages = signal<ChatMessage[]>(this.readStorage());
  private readonly _sending = signal(false);

  readonly messages = this._messages.asReadonly();
  readonly sending = this._sending.asReadonly();
  readonly isEmpty = computed(() => this._messages().length === 0);

  constructor() {
    effect(() => {
      const list = this._messages();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // storage may be full or unavailable — ignore.
      }
    });
  }

  async send(query: string, limit: number = DEFAULT_LIMIT): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed || this._sending()) return;

    const userMsg: ChatMessage = {
      id: makeId(),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    this._messages.update(list => [...list, userMsg]);
    this._sending.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<SearchResponse>(
          `${this.api}/transcriptions/search`,
          { query: trimmed, limit },
        ),
      );
      this._messages.update(list => [
        ...list,
        {
          id: makeId(),
          role: 'assistant',
          text: extractAnswer(res),
          matches: extractMatches(res),
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      this._messages.update(list => [
        ...list,
        {
          id: makeId(),
          role: 'assistant',
          text: describeError(err),
          createdAt: new Date().toISOString(),
          error: true,
        },
      ]);
    } finally {
      this._sending.set(false);
    }
  }

  clear(): void {
    this._messages.set([]);
  }

  private readStorage(): ChatMessage[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
    } catch {
      return [];
    }
  }
}

function makeId(): string {
  return (
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  );
}

function extractAnswer(res: SearchResponse | null | undefined): string {
  if (!res) return 'No response.';
  if (typeof res.answer === 'string' && res.answer.trim()) {
    return res.answer.trim();
  }
  return 'No matches found in your recordings.';
}

function extractMatches(res: SearchResponse | null | undefined): ChatMatch[] {
  if (!res || !Array.isArray(res.matches)) return [];
  const out: ChatMatch[] = [];
  for (const m of res.matches) {
    const transcription =
      typeof m.transcription === 'string' ? m.transcription.trim() : '';
    if (!transcription) continue;
    const match: ChatMatch = { transcription };
    if (typeof m.createdAt === 'string') match.createdAt = m.createdAt;
    if (typeof m.similarityScore === 'number') match.similarityScore = m.similarityScore;
    out.push(match);
  }
  return out;
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; error?: { error?: string; message?: string }; message?: string };
    if (e.status === 401) return 'Your session has expired. Please sign in again.';
    if (e.status === 403) return 'You are not allowed to perform this search.';
    if (e.error?.error) return e.error.error;
    if (e.error?.message) return e.error.message;
    if (e.message) return e.message;
  }
  return 'Something went wrong. Please try again.';
}
