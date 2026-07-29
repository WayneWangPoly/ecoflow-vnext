import type { Role } from '@/domain/types';

export type DashboardNavigationTab = 'orders' | 'delivery' | 'reconciliation';
export type DashboardStage = 'blocked' | 'review' | 'ready' | 'warehouse' | 'route';

export function dashboardStageTarget(stage: DashboardStage, role: Role): DashboardNavigationTab {
  if (stage === 'warehouse' || stage === 'route') return 'delivery';
  if (stage === 'review' && role === 'account') return 'reconciliation';
  return 'orders';
}
