import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { StatusPill } from '@/components/ui/StatusPill';
import { WorkCard } from '@/components/ui/WorkCard';

export function PickerWavesPage() {
  const wave = mockRepository.pickWaves[0];
  return (
    <Page title="Waves" subtitle="Zone grouped work">
      <WorkCard title={wave.waveNumber} meta={`${wave.orderCount} orders · ${wave.taskCount} tasks`}>
        <StatusPill status={wave.status} />
      </WorkCard>
      <ActionRow>
        <PrimaryAction to={ROUTES.picker.waveDetail(wave.id)}>Open Wave</PrimaryAction>
        <SecondaryAction to={ROUTES.picker.home}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
