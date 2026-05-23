import { ROUTES } from '@/core/constants/routes';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function WarehouseReceivePage() {
  return (
    <Page title="Receiving" subtitle="Barcode to SKU, then staging">
      <WorkCard title="Receiving Batch" meta="SKU Lines 0 · Cartons 0 · Staging ready" />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.scan}>Scan Barcode</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.home}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
