import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';

import {
  RecordingFile,
  RecordingSession,
  RecordingsService,
} from './services/recordings.service';

@Component({
  selector: 'app-recordings',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatChipsModule,
  ],
  templateUrl: './recordings.component.html',
  styleUrl: './recordings.component.scss',
})
export class RecordingsComponent implements OnInit {
  readonly service = inject(RecordingsService);
  private readonly snack = inject(MatSnackBar);

  readonly playingPath = signal<string | null>(null);
  readonly expanded = signal<Set<string>>(new Set());

  readonly totalFiles = computed(() =>
    this.service.sessions().reduce((sum, s) => sum + s.files.length, 0),
  );

  readonly totalSize = computed(() =>
    this.service.sessions().reduce((sum, s) => sum + s.totalSize, 0),
  );

  ngOnInit(): void {
    void this.service.refresh().then(() => {
      const first = this.service.sessions()[0];
      if (first) this.expanded.set(new Set([first.sessionId]));
    });
  }

  isExpanded(session: RecordingSession): boolean {
    return this.expanded().has(session.sessionId);
  }

  toggle(session: RecordingSession): void {
    const next = new Set(this.expanded());
    if (next.has(session.sessionId)) next.delete(session.sessionId);
    else next.add(session.sessionId);
    this.expanded.set(next);
  }

  urlFor(file: RecordingFile): string {
    return this.service.publicUrl(file.path);
  }

  play(file: RecordingFile): void {
    this.playingPath.set(file.path);
  }

  stopPlayback(): void {
    this.playingPath.set(null);
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

  sessionDate(session: RecordingSession): Date | null {
    const m = session.sessionId.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/,
    );
    if (!m) return null;
    const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    const date = new Date(iso);
    return isNaN(date.getTime()) ? null : date;
  }

  segmentLabel(file: RecordingFile): string {
    const m = file.name.match(/segment-(\d+)/);
    return m ? `Segment ${parseInt(m[1], 10) + 1}` : file.name;
  }

  sessionDuration(session: RecordingSession): string {
    const seconds = session.files.length * 10;
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs ? `${mins}m ${secs}s` : `${mins}m`;
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
}
