import type { Role } from '@/domain/types';
import type { OperationalFlowStage } from '@/features/intelligence/operationalFlow';

export type DashboardNavigationTab = 'orders' | 'delivery' | 'reconciliation';
export type DashboardStage = OperationalFlowStage;

export function dashboardStageTarget(stage: DashboardStage, role: Role): DashboardNavigationTab {
  if (stage === 'WAREHOUSE' || stage === 'STAGED' || stage === 'ROUTE' || stage === 'DELIVERED') {
    return 'delivery';
  }
  if (stage === 'FINANCE_REVIEW' && role === 'account') return 'reconciliation';
  return 'orders';
}
