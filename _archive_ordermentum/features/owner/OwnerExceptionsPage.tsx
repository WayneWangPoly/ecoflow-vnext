import { ROUTES } from '@/core/constants/routes';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function OwnerExceptionsPage() {
  return (
    <Page title="Exceptions" subtitle="Operational issues return here">
      <WorkCard title="No fulfilment exception" meta="Import exceptions are handled separately." />
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.importExceptions}>Import Exceptions</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.dashboard}>Dashboard</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
