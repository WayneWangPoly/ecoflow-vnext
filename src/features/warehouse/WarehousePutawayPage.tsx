import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function WarehousePutawayPage() {
  const target = mockRepository.locations.find((location) => location.isPickable) ?? mockRepository.locations[0];
  return (
    <Page title="Putaway" subtitle="Move stock from staging to real location">
      <WorkCard title={target.locationCode} meta={target.barcodeValue} />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.locationDetail(target.id)}>Move to Location</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.home}>Report Issue</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
