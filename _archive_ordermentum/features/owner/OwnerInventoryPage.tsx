import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';
import { locationCode, skuName } from '@/features/shared/lookups';

export function OwnerInventoryPage() {
  const balance = mockRepository.inventoryBalances[0];
  return (
    <Page title="Inventory" subtitle="Real locations and SKU balances">
      <WorkCard title={skuName(balance.skuId)} meta={`${locationCode(balance.locationId)} · Available ${balance.quantityAvailable}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.locations}>Open Locations</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.orders}>Orders</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
