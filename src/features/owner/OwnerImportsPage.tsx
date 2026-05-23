import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';

export function OwnerImportsPage() {
  const latest = mockRepository.importBatches[0];
  return (
    <Page title="Imports" subtitle="Ordermentum batches">
      <WorkCard title="Latest import" meta={`${latest.importedOrders}/${latest.totalOrders} imported`}>
        <StatusPill status={latest.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.importExceptions}>Fix Exceptions</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.orders}>Orders</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
