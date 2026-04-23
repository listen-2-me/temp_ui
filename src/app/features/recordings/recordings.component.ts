import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import {
  RecordingFile,
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
    MatExpansionModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './recordings.component.html',
  styleUrl: './recordings.component.scss',
})
export class RecordingsComponent implements OnInit {
  readonly service = inject(RecordingsService);
  private readonly snack = inject(MatSnackBar);

  readonly playingPath = signal<string | null>(null);

  readonly totalFiles = computed(() =>
    this.service.sessions().reduce((sum, s) => sum + s.files.length, 0),
  );

  ngOnInit(): void {
    void this.service.refresh();
  }

  urlFor(file: RecordingFile): string {
    return this.service.publicUrl(file.path);
  }

  play(file: RecordingFile): void {
    this.playingPath.set(file.path);
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
