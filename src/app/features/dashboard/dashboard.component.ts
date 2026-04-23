import { Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { RecordingService } from './services/recording.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly recording = inject(RecordingService);
  private readonly snack = inject(MatSnackBar);

  readonly statusLabel = computed(() =>
    this.recording.isRecording() ? 'Recording is starting…' : 'Ready to record',
  );

  readonly helperText = computed(() =>
    this.recording.isRecording()
      ? 'Streaming 10-second .wav segments to Supabase. Tap again to stop.'
      : 'Tap the button to start recording from your microphone.',
  );

  readonly buttonLabel = computed(() =>
    this.recording.isRecording() ? 'Stop' : 'Start',
  );

  readonly buttonIcon = computed(() =>
    this.recording.isRecording() ? 'stop' : 'mic',
  );

  constructor() {
    effect(() => {
      const error = this.recording.error();
      if (error) {
        this.snack.open(error, 'Dismiss', { duration: 5000 });
      }
    });
  }

  async toggle(): Promise<void> {
    await this.recording.toggle();
  }
}
