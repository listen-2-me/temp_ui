import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCardModule } from '@angular/material/card';

import { ChatService } from './services/chat.service';
import { RecordingsService } from '../recordings/services/recordings.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatCardModule,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements OnInit, AfterViewChecked {
  readonly chat = inject(ChatService);
  readonly recordings = inject(RecordingsService);
  private readonly fb = inject(FormBuilder);

  @ViewChild('scroller') private scroller?: ElementRef<HTMLDivElement>;

  readonly recordingsLoaded = signal(false);
  private shouldScroll = false;

  readonly hasSound = computed(() => this.recordings.sessions().length > 0);

  readonly inputDisabled = computed(
    () => !this.hasSound() || this.chat.sending(),
  );

  readonly form = this.fb.nonNullable.group({
    query: ['', [Validators.required, Validators.maxLength(2000)]],
  });

  constructor() {
    effect(() => {
      // Re-evaluate disabled state whenever inputs change.
      if (this.inputDisabled()) {
        this.form.controls.query.disable({ emitEvent: false });
      } else {
        this.form.controls.query.enable({ emitEvent: false });
      }
    });

    effect(() => {
      // When messages list changes, request a scroll on next view check.
      this.chat.messages();
      this.shouldScroll = true;
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.recordings.sessions().length === 0 && !this.recordings.loading()) {
      await this.recordings.refresh();
    }
    this.recordingsLoaded.set(true);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.scroller) {
      const el = this.scroller.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.chat.sending() || !this.hasSound()) return;
    const { query } = this.form.getRawValue();
    this.form.reset({ query: '' });
    await this.chat.send(query);
  }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.submit();
    }
  }

  clear(): void {
    this.chat.clear();
  }
}
