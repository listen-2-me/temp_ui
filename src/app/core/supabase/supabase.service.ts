import { Injectable } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

export interface StorageEntry {
  name: string;
  id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient | null = null;

  get isConfigured(): boolean {
    return !!environment.supabaseUrl && !!environment.supabaseAnonKey;
  }

  get bucket(): string {
    return environment.supabaseBucket;
  }

  getClient(): SupabaseClient {
    if (!this.isConfigured) {
      throw new Error(
        'Supabase is not configured. Set supabaseUrl and supabaseAnonKey in environment.ts.',
      );
    }
    if (!this.client) {
      this.client = createClient(
        environment.supabaseUrl,
        environment.supabaseAnonKey,
        { auth: { persistSession: false } },
      );
    }
    return this.client;
  }

  async uploadRecording(path: string, blob: Blob): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(this.bucket)
      .upload(path, blob, {
        contentType: 'audio/wav',
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;
    return data.path;
  }

  async listFolder(path: string): Promise<StorageEntry[]> {
    const { data, error } = await this.getClient()
      .storage.from(this.bucket)
      .list(path, {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'desc' },
      });

    if (error) throw error;
    return data ?? [];
  }

  async createSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  }

  getPublicUrl(path: string): string {
    const { data } = this.getClient()
      .storage.from(this.bucket)
      .getPublicUrl(path);
    return data.publicUrl;
  }
}
