import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';
import { customerName, siteName } from '@/features/shared/lookups';

export function OwnerOrdersPage() {
  const order = mockRepository.orders[0];
  return (
    <Page title="Release Queue" subtitle="Imported orders ready for owner approval">
      <WorkCard title={order.orderNumber} meta={`${customerName(order.customerId)} · ${siteName(order.customerSiteId)}`}>
        <StatusPill status={order.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.orderDetail(order.id)}>Open Order</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.inventory}>Inventory</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
