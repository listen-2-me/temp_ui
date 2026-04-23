import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import {
  RecordingSession,
  RecordingsService,
} from './services/recordings.service';

@Component({
  selector: 'app-recordings',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressBarModule,
  ],
  templateUrl: './recordings.component.html',
  styleUrl: './recordings.component.scss',
})
export class RecordingsComponent implements OnInit {
  readonly service = inject(RecordingsService);

  readonly columns = ['date', 'files', 'duration', 'size', 'actions'];

  readonly totalFiles = computed(() =>
    this.service.sessions().reduce((sum, s) => sum + s.files.length, 0),
  );

  ngOnInit(): void {
    void this.service.refresh();
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
