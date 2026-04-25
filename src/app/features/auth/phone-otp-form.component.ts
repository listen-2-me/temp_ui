import {
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AuthService } from '../../core/auth/auth.service';
import { AuthMode } from '../../core/auth/auth.types';

type Step = 'phone' | 'otp';

const PHONE_PREFIX = '+90';
const MAX_NATIONAL_DIGITS = 10;

const ERROR_MESSAGES: Record<AuthMode, Record<number, string>> = {
  login: {
    400: 'Phone number is required.',
    401: 'Invalid or expired code.',
    403: 'This account has been blocked. Contact support.',
  },
  register: {
    400: 'Phone number is required.',
    401: 'Invalid or expired code.',
    409: 'An account with this phone number already exists.',
  },
};

@Component({
  selector: 'app-phone-otp-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
  ],
  templateUrl: './phone-otp-form.component.html',
  styleUrl: './phone-otp-form.component.scss',
})
export class PhoneOtpFormComponent {
  readonly mode = input.required<AuthMode>();

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  readonly step = signal<Step>('phone');
  readonly loading = signal(false);
  readonly submittedPhone = signal('');

  readonly phoneForm = this.fb.nonNullable.group({
    phoneNumber: [
      PHONE_PREFIX,
      [Validators.required, Validators.pattern(/^\+90\d{10}$/)],
    ],
  });

  readonly otpForm = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });

  readonly title = computed(() =>
    this.mode() === 'login' ? 'Sign in or sign up' : 'Create your account',
  );

  readonly subtitle = computed(() =>
    this.mode() === 'login'
      ? 'Enter your phone number — we\'ll send a verification code.'
      : 'We\'ll send a verification code to your phone.',
  );

  readonly primaryCta = computed(() =>
    this.mode() === 'login' ? 'Send code' : 'Send verification code',
  );

  readonly showAltRoute = computed(() => this.mode() === 'register');

  readonly altRoute = computed(() =>
    this.mode() === 'login' ? '/register' : '/login',
  );

  readonly altPrompt = computed(() =>
    this.mode() === 'login'
      ? "Don't have an account?"
      : 'Already have an account?',
  );

  readonly altCta = computed(() =>
    this.mode() === 'login' ? 'Register' : 'Sign in',
  );

  constructor() {
    this.phoneForm.controls.phoneNumber.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.normalizePhone(value));
  }

  onPhoneKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const prefixLen = PHONE_PREFIX.length;

    if (event.key === 'Backspace' && start <= prefixLen && end <= prefixLen) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Delete' && start < prefixLen) {
      event.preventDefault();
      return;
    }
  }

  onPhoneFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    queueMicrotask(() => {
      if ((input.selectionStart ?? 0) < PHONE_PREFIX.length) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  onPhoneClick(event: MouseEvent): void {
    const input = event.target as HTMLInputElement;
    if ((input.selectionStart ?? 0) < PHONE_PREFIX.length) {
      input.setSelectionRange(PHONE_PREFIX.length, PHONE_PREFIX.length);
    }
  }

  submitPhone(): void {
    if (this.phoneForm.invalid || this.loading()) return;

    const phoneNumber = this.phoneForm.getRawValue().phoneNumber.trim();
    const req$ =
      this.mode() === 'login'
        ? this.auth.login(phoneNumber)
        : this.auth.register(phoneNumber);

    this.loading.set(true);
    req$.subscribe({
      next: () => {
        this.submittedPhone.set(phoneNumber);
        this.step.set('otp');
        this.otpForm.reset();
        this.loading.set(false);
        this.snack.open('Verification code sent.', 'Dismiss', { duration: 3000 });
      },
      error: err => {
        this.loading.set(false);
        this.handleError(err);
      },
    });
  }

  submitOtp(): void {
    if (this.otpForm.invalid || this.loading()) return;

    const code = this.otpForm.getRawValue().code.trim();
    const phoneNumber = this.submittedPhone();
    const req$ =
      this.mode() === 'login'
        ? this.auth.verifyLogin(phoneNumber, code)
        : this.auth.verifyRegister(phoneNumber, code);

    this.loading.set(true);
    req$.subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: err => {
        this.loading.set(false);
        this.handleError(err);
      },
    });
  }

  editPhone(): void {
    this.step.set('phone');
    this.otpForm.reset();
  }

  resendCode(): void {
    if (this.loading()) return;
    const phoneNumber = this.submittedPhone();
    if (!phoneNumber) {
      this.editPhone();
      return;
    }
    const req$ =
      this.mode() === 'login'
        ? this.auth.login(phoneNumber)
        : this.auth.register(phoneNumber);

    this.loading.set(true);
    req$.subscribe({
      next: () => {
        this.loading.set(false);
        this.snack.open('New code sent.', 'Dismiss', { duration: 3000 });
      },
      error: err => {
        this.loading.set(false);
        this.handleError(err);
      },
    });
  }

  private normalizePhone(raw: string): void {
    const digitsOnly = (raw ?? '').replace(/\D/g, '');
    const national = digitsOnly.startsWith('90')
      ? digitsOnly.slice(2)
      : digitsOnly;
    const trimmed = national.slice(0, MAX_NATIONAL_DIGITS);
    const next = PHONE_PREFIX + trimmed;
    if (next !== raw) {
      this.phoneForm.controls.phoneNumber.setValue(next, { emitEvent: false });
    }
  }

  private handleError(err: HttpErrorResponse): void {
    const map = ERROR_MESSAGES[this.mode()];
    const msg =
      map[err.status] ?? 'Something went wrong. Please try again.';
    this.snack.open(msg, 'Dismiss', { duration: 5000 });
  }
}
