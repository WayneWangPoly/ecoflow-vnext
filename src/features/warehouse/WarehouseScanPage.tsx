import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';
import { skuName } from '@/features/shared/lookups';

export function WarehouseScanPage() {
  const barcode = mockRepository.skuBarcodes[0];
  return (
    <Page title="Scan Result" subtitle="Packaging barcode lookup">
      <WorkCard title={skuName(barcode.skuId)} meta={`${barcode.barcodeValue} · ${barcode.unitLevel} × ${barcode.quantityInBaseUnit}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.receive}>Add to Batch</PrimaryAction>
        <SecondaryAction to={ROUTES.warehouse.receive}>Change Qty</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
