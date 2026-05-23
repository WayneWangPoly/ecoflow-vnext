import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';

export function OwnerImportExceptionsPage() {
  const exception = mockRepository.importExceptions[0];
  return (
    <Page title="Import Exception" subtitle="Fix mapping before release">
      <WorkCard title={exception.exceptionType.replaceAll('_', ' ')} meta={exception.message}>
        <StatusPill status={exception.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.orders}>Open Release Queue</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.imports}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
