import { ROUTES } from '@/core/constants/routes';
import { mockRepository } from '@/core/repositories/mockRepository';
import { ActionRow, PrimaryAction, SecondaryAction } from '@/components/ui/ActionButtons';
import { Page } from '@/components/ui/Page';
import { SummaryCard } from '@/components/ui/SummaryCard';

export function PickerHome() {
  const wave = mockRepository.pickWaves[0];
  return (
    <Page title="Picker" subtitle="Wave → pick → pack">
      <div className="summary-grid">
        <SummaryCard label="Open waves" value={mockRepository.pickWaves.length} />
        <SummaryCard label="Tasks" value={wave.taskCount} />
      </div>
      <ActionRow>
        <PrimaryAction to={ROUTES.picker.waveDetail(wave.id)}>Start Next Wave</PrimaryAction>
        <SecondaryAction to={ROUTES.picker.waves}>View Waves</SecondaryAction>
      </ActionRow>
    </Page>
  );
}
