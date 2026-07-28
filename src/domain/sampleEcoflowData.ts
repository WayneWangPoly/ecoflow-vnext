import { createSampleOrdermentumRepository } from '@/data/repositories/sampleOrdermentumRepository';
import { buildEcoFlowData } from './ecoflowData';

export function buildDevelopmentSampleData() {
  return buildEcoFlowData(createSampleOrdermentumRepository());
}
