import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function WarehouseLocationsPage() {
  const location = mockRepository.locations.find((candidate) => candidate.isPickable) ?? mockRepository.locations[0];
  return (
    <Page title="Locations" subtitle="Real warehouse location master">
      <WorkCard title={location.locationCode} meta={`${location.locationType} · ${location.zone}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.locationDetail(location.id)}>Open Location</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.inventory}>Inventory</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
