import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';
import { locationCode, skuName } from '@/features/shared/lookups';

export function PickerTaskPage() {
  const { taskId } = useParams();
  const task = mockRepository.pickTasks.find((candidate) => candidate.id === taskId) ?? mockRepository.pickTasks[0];
  return (
    <Page title="Pick Task" subtitle={locationCode(task.fromLocationId)}>
      <WorkCard title={skuName(task.skuId)} meta={`Scan barcode before confirm · Qty ${task.requestedQuantity}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.picker.packOrder(task.orderId)}>Confirm Picked</PrimaryAction>
        <SecondaryAction to={ROUTES.owner.exceptions}>Report Short</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
