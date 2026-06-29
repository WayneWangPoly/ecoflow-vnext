import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function PickerPackPage() {
  const { orderId } = useParams();
  return (
    <Page title="Pack Order" subtitle={orderId ?? 'Order'}>
      <WorkCard title="Ready to pack" meta="Packed orders become dispatch candidates." />
      <ActionRow>
        <PrimaryAction to={ROUTES.owner.dispatch}>Mark Packed</PrimaryAction>
        <SecondaryAction to={ROUTES.picker.home}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
