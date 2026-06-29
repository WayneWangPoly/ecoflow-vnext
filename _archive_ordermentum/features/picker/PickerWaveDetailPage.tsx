import { useParams } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { WorkCard } from '@/components/ui/WorkCard';
import { locationCode, skuName } from '@/features/shared/lookups';

export function PickerWaveDetailPage() {
  const { waveId } = useParams();
  const wave = mockRepository.pickWaves.find((candidate) => candidate.id === waveId) ?? mockRepository.pickWaves[0];
  const task = mockRepository.pickTasks.find((candidate) => candidate.pickWaveId === wave.id) ?? mockRepository.pickTasks[0];
  return (
    <Page title={wave.waveNumber} subtitle="Next pick task">
      <WorkCard title={locationCode(task.fromLocationId)} meta={`${skuName(task.skuId)} · Qty ${task.requestedQuantity}`} />
      <ActionRow>
        <PrimaryAction to={ROUTES.picker.taskDetail(task.id)}>Start Picking</PrimaryAction>
        <SecondaryAction to={ROUTES.picker.waves}>Back</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
