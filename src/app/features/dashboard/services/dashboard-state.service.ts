import { Injectable, computed, signal } from '@angular/core';

export interface StatCard {
  id: number;
  title: string;
  value: number;
  icon: string;
  color: 'primary' | 'accent' | 'warn';
}

@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  private readonly _stats = signal<StatCard[]>([
    { id: 1, title: 'Active Users', value: 1248, icon: 'group', color: 'primary' },
    { id: 2, title: 'Revenue', value: 8420, icon: 'payments', color: 'accent' },
    { id: 3, title: 'Sessions', value: 312, icon: 'trending_up', color: 'primary' },
    { id: 4, title: 'Errors', value: 7, icon: 'error_outline', color: 'warn' },
  ]);

  readonly stats = this._stats.asReadonly();

  readonly total = computed(() =>
    this._stats().reduce((sum, s) => sum + s.value, 0),
  );

  increment(id: number): void {
    this._stats.update(list =>
      list.map(s => (s.id === id ? { ...s, value: s.value + 1 } : s)),
    );
  }

  decrement(id: number): void {
    this._stats.update(list =>
      list.map(s => (s.id === id ? { ...s, value: Math.max(0, s.value - 1) } : s)),
    );
  }

  reset(): void {
    this._stats.update(list => list.map(s => ({ ...s, value: 0 })));
  }
}
