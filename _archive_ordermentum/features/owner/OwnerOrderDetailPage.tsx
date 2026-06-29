import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';

export function OwnerOrderDetailPage() {
  const { orderId } = useParams();
  const order = mockRepository.orders.find((candidate) => candidate.id === orderId) ?? mockRepository.orders[0];
  const lines = mockRepository.orderLines.filter((line) => line.orderId === order.id);

  return (
    <Page title={order.orderNumber} subtitle="Owner release check">
      <WorkCard title={`${lines.length} SKU line${lines.length === 1 ? '' : 's'}`} meta={`Delivery zone: ${order.deliveryZone ?? 'Unassigned'}`}>
        <StatusPill status={order.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.warehouse.home}>Approve Release</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.orders}>Hold</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
