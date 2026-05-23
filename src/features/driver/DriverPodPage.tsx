import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';

export function DriverPodPage() {
  const { stopId } = useParams();
  return (
    <Page title="POD Photo" subtitle={stopId ?? 'Stop'}>
      <WorkCard title="Photo required" meta="Supabase Storage bucket will store POD images later." />
      <ActionRow>
        <PrimaryAction to={ROUTES.driver.home}>Take Photo</PrimaryAction>
        <SecondaryAction to={ROUTES.driver.home}>Retake</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
