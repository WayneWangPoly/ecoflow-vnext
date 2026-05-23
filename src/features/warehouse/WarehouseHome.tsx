import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { SummaryCard } from '@/components/ui/SummaryCard';

export function WarehouseHome() {
  const staging = mockRepository.locations.find((location) => location.isStaging)?.locationCode ?? 'STAGING';
  const openPickTasks = mockRepository.pickTasks.length;
  return (
    <Page title="Warehouse" subtitle="Receive, stage, putaway">
      <div className="summary-grid">
        <SummaryCard label="Staging" value={staging} />
        <SummaryCard label="Pick tasks" value={openPickTasks} />
      </div>
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.receive}>Start Receiving</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.putaway}>Putaway</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
