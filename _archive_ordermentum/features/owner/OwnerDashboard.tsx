import { ROUTES } from '@/core/constants/routes';
import { ORDER_STATUSES } from '@/core/constants/statuses';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { SummaryCard } from '@/components/ui/SummaryCard';

export function OwnerDashboard() {
  const importExceptions = mockRepository.importExceptions.length;
  const imported = mockRepository.importBatches.reduce((sum, batch) => sum + batch.importedOrders, 0);
  const stockReserved = mockRepository.orders.filter((order) => order.status === ORDER_STATUSES.stockReserved).length;

  return (
    <Page title="Owner" subtitle="Ordermentum fulfilment control">
      <div className="summary-grid">
        <SummaryCard label="Imported" value={imported} />
        <SummaryCard label="Import exceptions" value={importExceptions} />
        <SummaryCard label="Stock reserved" value={stockReserved} />
      </div>
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.imports}>Review Imports</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.dispatch}>Dispatch</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
