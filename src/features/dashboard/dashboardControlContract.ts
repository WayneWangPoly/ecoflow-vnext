import type { ControlStatusTone } from '@/features/intelligence/designSystem/primitives';

export type DashboardOperationalTone = 'good' | 'warn' | 'danger' | 'neutral';

export function dashboardControlTone(tone: DashboardOperationalTone): ControlStatusTone {
  if (tone === 'good') return 'success';
  if (tone === 'warn') return 'warning';
  return tone;
}

export function dashboardSourceTone(status: string): ControlStatusTone {
  const normalized = status.trim().toUpperCase();
  if (normalized === 'HEALTHY' || normalized === 'SUCCESS' || normalized === 'READY') return 'success';
  if (normalized === 'CHECKING' || normalized === 'DEGRADED' || normalized === 'WARNING') return 'warning';
  if (normalized === 'FAILED' || normalized === 'UNAVAILABLE' || normalized === 'ERROR') return 'danger';
  return 'neutral';
}
