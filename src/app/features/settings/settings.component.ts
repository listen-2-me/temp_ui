import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <h1>Settings</h1>
    <mat-card appearance="outlined">
      <mat-card-header>
        <mat-icon mat-card-avatar>settings</mat-icon>
        <mat-card-title>Preferences</mat-card-title>
        <mat-card-subtitle>Placeholder feature module</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <p>Add your settings UI here.</p>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    h1 { margin: 0 0 16px; font-weight: 500; }
  `],
})
export class SettingsComponent {}
