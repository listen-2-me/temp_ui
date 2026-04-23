import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';

const AUTH_FREE_PATTERNS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken();
  const skipAuth = AUTH_FREE_PATTERNS.some(p => req.url.includes(p));

  const authReq = token && !skipAuth
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && token && !skipAuth) {
        auth.logout();
      }
      return throwError(() => err);
    }),
  );
};
