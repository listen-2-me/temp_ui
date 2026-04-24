import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import {
  RecordingFile,
  RecordingSession,
  RecordingsService,
  TranscriptionResult,
} from '../services/recordings.service';

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './session-detail.component.html',
  styleUrl: './session-detail.component.scss',
})
export class SessionDetailComponent implements OnInit {
  readonly sessionId = input.required<string>();

  readonly service = inject(RecordingsService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  readonly notFound = signal(false);
  readonly transcriptions = signal<Record<string, TranscriptionResult>>({});
  private readonly transcriptionsLoadedFor = signal<string | null>(null);

  readonly session = computed<RecordingSession | null>(() => {
    const id = this.sessionId();
    return this.service.sessions().find(s => s.sessionId === id) ?? null;
  });

  readonly sessionDate = computed(() => {
    const s = this.session();
    if (!s) return null;
    const m = s.sessionId.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/,
    );
    if (!m) return null;
    const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    const date = new Date(iso);
    return isNaN(date.getTime()) ? null : date;
  });

  async ngOnInit(): Promise<void> {
    if (this.service.sessions().length === 0) {
      await this.service.refresh();
    }
    const session = this.session();
    if (!session) {
      this.notFound.set(true);
      return;
    }
    await this.loadTranscriptions(session);
  }

  private async loadTranscriptions(session: RecordingSession): Promise<void> {
    if (this.transcriptionsLoadedFor() === session.sessionId) return;
    this.transcriptionsLoadedFor.set(session.sessionId);

    const results = await Promise.all(
      session.files.map(async file => {
        const result = await this.service.fetchTranscription(
          session.sessionId,
          file.name,
        );
        return [file.path, result] as const;
      }),
    );

    const map: Record<string, TranscriptionResult> = {};
    for (const [path, result] of results) {
      if (result && result.status === 'COMPLETED') {
        map[path] = result;
      }
    }
    this.transcriptions.set(map);
  }

  transcriptionFor(file: RecordingFile): TranscriptionResult | null {
    return this.transcriptions()[file.path] ?? null;
  }

  urlFor(file: RecordingFile): string {
    return this.service.publicUrl(file.path);
  }

  segmentLabel(file: RecordingFile): string {
    const m = file.name.match(/segment-(\d+)/);
    return m ? `Segment ${parseInt(m[1], 10) + 1}` : file.name;
  }

  formatSize(bytes: number): string {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  download(file: RecordingFile): void {
    try {
      const link = document.createElement('a');
      link.href = this.urlFor(file);
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : 'Could not download recording.',
        'Dismiss',
        { duration: 4000 },
      );
    }
  }

  back(): void {
    this.router.navigate(['/recordings']);
  }
}
