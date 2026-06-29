import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';

export function OwnerDispatchPage() {
  const run = mockRepository.deliveryRuns[0];
  return (
    <Page title="Dispatch" subtitle="Packed orders to delivery run">
      <WorkCard title={run.runNumber} meta={`${run.stopCount} stops · ${run.plannedDate}`}>
        <StatusPill status={run.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.driver.runDetail(run.id)}>Open Run</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.orders}>Orders</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
