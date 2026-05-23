import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function WarehouseLocationDetailPage() {
  const { locationId } = useParams();
  const location = mockRepository.locations.find((candidate) => candidate.id === locationId) ?? mockRepository.locations[0];
  const balances = mockRepository.inventoryBalances.filter((balance) => balance.locationId === location.id);
  return (
    <Page title={location.locationCode} subtitle={location.locationCode}>
      <WorkCard title={`${balances.length} SKU balance${balances.length === 1 ? '' : 's'}`} meta={`${location.locationType} · Pickable: ${location.isPickable ? 'yes' : 'no'}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.stocktake}>Stocktake</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.locations}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
