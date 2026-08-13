import { readFileSync } from 'node:fs';

const panelPath = 'src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx';
const exportPanelPath = 'src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx';
const repositoryPath = 'src/data/repositories/savedViewRepository.ts';
const comparisonRepositoryPath = 'src/data/repositories/comparisonCandidates.ts';
const exportRepositoryPath = 'src/data/repositories/authoritativeExport.ts';

const panel = readFileSync(panelPath, 'utf8');
const exportPanel = readFileSync(exportPanelPath, 'utf8');
const repository = readFileSync(repositoryPath, 'utf8');
const comparisonRepository = readFileSync(comparisonRepositoryPath, 'utf8');
const exportRepository = readFileSync(exportRepositoryPath, 'utf8');
const failures = [];

function forbid(label, pattern, source = panel, path = panelPath) { if (pattern.test(source)) failures.push(`${label} remains in ${path}`); }
function requireText(label, source, text, path) { if (!source.includes(text)) failures.push(`${label} missing from ${path}`); }

forbid('browser-declared ALLOWED permission', /permission\s*:\s*['"]ALLOWED['"]/);
forbid('manual comparison entity input', /Comparison entity ID|setEntityId\s*\(/);
forbid('historical misleading current-table export', /Export current table view/);
forbid('historical misleading selected-record export', /Export selected records/);
forbid('historical misleading current-chart export', /Export current chart dataset/);
forbid('client current-row CSV construction', /buildCsvExport\s*\(|saveCsv\s*\(/);
forbid('synthetic chart values', /value\s*:\s*index\s*\+\s*1/);
forbid('direct business-table mutation', /\.from\s*\([^)]*\)[\s\S]{0,300}\.(?:insert|update|upsert|delete)\s*\(/);
for (const marker of ['tableExportRows','selectedRecordExportRows','chartExportRows','exportColumns']) forbid(`browser export payload ${marker}`, new RegExp(marker), `${panel}\n${exportPanel}`, `${panelPath} + ${exportPanelPath}`);

requireText('governed Saved Views read', panel, "repository.readSavedViews('analytics')", panelPath);
requireText('governed Saved Views command path', panel, 'repository.applyCommand({', panelPath);
requireText('Quick Actions', panel, 'quickActionDefinitions', panelPath);
requireText('analytics RPC schema boundary', repository, ".schema('analytics')", repositoryPath);
requireText('Saved Views read RPC contract', repository, 'intelligenceSavedViewReadRpcName', repositoryPath);
requireText('Saved Views command RPC contract', repository, 'intelligenceSavedViewCommandRpcName', repositoryPath);
requireText('governed comparison read', panel, 'comparisonRepository.readCandidates', panelPath);
requireText('comparison RPC boundary', comparisonRepository, "rpc('ecoflow_read_comparison_candidates_v1'", comparisonRepositoryPath);
requireText('authoritative export mount', panel, '<AuthoritativeExportPanel', panelPath);
requireText('authoritative export RPC boundary', exportRepository, "rpc('ecoflow_read_authoritative_export_v1'", exportRepositoryPath);
requireText('server-requery export presentation', exportPanel, 'Browser rows and cached labels are never export authority.', exportPanelPath);

if (failures.length) {
  console.error('TRANSFORM-008A analytics productivity truth audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('TRANSFORM-008A analytics productivity truth audit passed.');
console.log('- Saved Views remain on analytics-schema server RPC authority.');
console.log('- Quick Actions remain navigation-only.');
console.log('- Comparison and export now remain server-authoritative; browser rows, permissions and arbitrary IDs are not authority.');
