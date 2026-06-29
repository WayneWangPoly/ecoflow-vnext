import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';
import { siteName } from '@/features/shared/lookups';

export function DriverRunPage() {
  const { runId } = useParams();
  const run = mockRepository.deliveryRuns.find((candidate) => candidate.id === runId) ?? mockRepository.deliveryRuns[0];
  const stop = mockRepository.deliveryStops.find((candidate) => candidate.deliveryRunId === run.id) ?? mockRepository.deliveryStops[0];
  return (
    <Page title={run.runNumber} subtitle="Next stop">
      <WorkCard title={`#${stop.stopSequence} ${siteName(stop.customerSiteId)}`} meta={stop.driverNote}>
        <StatusPill status={stop.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.driver.stopDetail(stop.id)}>Next Stop</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.dispatch}>Map</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
