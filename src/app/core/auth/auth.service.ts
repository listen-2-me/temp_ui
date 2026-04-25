import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthTokens, OtpInitResponse, User } from './auth.types';

const STORAGE_KEY = 'listen2me.auth';

interface StoredTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = environment.apiBaseUrl;

  private readonly _tokens = signal<StoredTokens | null>(this.readStorage());
  private readonly _user = signal<User | null>(null);

  readonly tokens = this._tokens.asReadonly();
  readonly user = this._user.asReadonly();
  readonly accessToken = computed(() => this._tokens()?.accessToken ?? null);
  readonly isAuthenticated = computed(() => !!this._tokens());

  constructor() {
    effect(() => {
      const tokens = this._tokens();
      if (tokens) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }

  register(phoneNumber: string): Observable<OtpInitResponse> {
    return this.http.post<OtpInitResponse>(`${this.api}/auth/register`, { phoneNumber });
  }

  verifyRegister(phoneNumber: string, code: string): Observable<AuthTokens> {
    return this.http
      .post<AuthTokens>(`${this.api}/auth/register/verify`, { phoneNumber, code })
      .pipe(tap(tokens => this.storeTokens(tokens)));
  }

  login(phoneNumber: string): Observable<OtpInitResponse> {
    return this.http.post<OtpInitResponse>(`${this.api}/auth/login-register`, { phoneNumber });
  }

  verifyLogin(phoneNumber: string, code: string): Observable<AuthTokens> {
    return this.http
      .post<AuthTokens>(`${this.api}/auth/login/verify`, { phoneNumber, code })
      .pipe(tap(tokens => this.storeTokens(tokens)));
  }

  refresh(): Observable<AuthTokens> {
    const refreshToken = this._tokens()?.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    return this.http
      .post<AuthTokens>(`${this.api}/auth/refresh`, { refreshToken })
      .pipe(tap(tokens => this.storeTokens(tokens)));
  }

  logout(): void {
    const refreshToken = this._tokens()?.refreshToken;
    this.clearSession();
    if (refreshToken) {
      this.http
        .post(`${this.api}/auth/logout`, { refreshToken })
        .subscribe({
          next: () => this.router.navigate(['/login']),
          error: () => this.router.navigate(['/login']),
        });
    } else {
      this.router.navigate(['/login']);
    }
  }

  fetchMe(): Observable<User> {
    return this.http
      .get<User>(`${this.api}/me`)
      .pipe(tap(user => this._user.set(user)));
  }

  clearSession(): void {
    this._tokens.set(null);
    this._user.set(null);
  }

  private storeTokens(tokens: AuthTokens): void {
    this._tokens.set({
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    });
  }

  private readStorage(): StoredTokens | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  }
}
