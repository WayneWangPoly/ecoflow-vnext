import { ROUTES } from '@/core/constants/routes';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function WarehouseStocktakePage() {
  return (
    <Page title="Stocktake" subtitle="Scan location, then SKU">
      <WorkCard title="Location-first count" meta="Every variance should become a stock movement." />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.locations}>Scan Location</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.home}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
