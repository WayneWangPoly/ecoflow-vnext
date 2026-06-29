import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';
import { siteName } from '@/features/shared/lookups';

export function DriverStopPage() {
  const { stopId } = useParams();
  const stop = mockRepository.deliveryStops.find((candidate) => candidate.id === stopId) ?? mockRepository.deliveryStops[0];
  return (
    <Page title="Stop Detail" subtitle={`Stop #${stop.stopSequence}`}>
      <WorkCard title={siteName(stop.customerSiteId)} meta={stop.driverNote ?? 'No driver note'} />
      <ActionRow>
        <PrimaryAction to={ROUTES.driver.stopPod(stop.id)}>Complete Delivery</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.exceptions}>Report Issue</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
