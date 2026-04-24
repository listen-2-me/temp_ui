import { Routes } from '@angular/router';

import { MainLayoutComponent } from './core/layout/main-layout/main-layout.component';
import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register.component').then(m => m.RegisterComponent),
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(
            m => m.DashboardComponent,
          ),
      },
      {
        path: 'recordings',
        loadComponent: () =>
          import('./features/recordings/recordings.component').then(
            m => m.RecordingsComponent,
          ),
      },
      {
        path: 'recordings/:sessionId',
        loadComponent: () =>
          import(
            './features/recordings/session-detail/session-detail.component'
          ).then(m => m.SessionDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
