import { Injectable } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

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
}
