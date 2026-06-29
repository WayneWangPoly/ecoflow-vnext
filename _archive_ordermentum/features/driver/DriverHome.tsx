import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { SummaryCard } from '@/components/ui/SummaryCard';

export function DriverHome() {
  const run = mockRepository.deliveryRuns[0];
  return (
    <Page title="Driver" subtitle="Stops and POD only">
      <div className="summary-grid">
        <SummaryCard label="Run" value={run.runNumber} />
        <SummaryCard label="Stops" value={run.stopCount} />
      </div>
      <ActionRow>
        <PrimaryAction to={ROUTES.driver.runDetail(run.id)}>Start Run</PrimaryAction>
        <SecondaryAction to={ROUTES.driver.runDetail(run.id)}>View Stops</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
