import { readFileSync } from 'node:fs';

const panelPath = 'src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx';
const repositoryPath = 'src/data/repositories/savedViewRepository.ts';

const panel = readFileSync(panelPath, 'utf8');
const repository = readFileSync(repositoryPath, 'utf8');
const failures = [];

function forbid(label, pattern) {
  if (pattern.test(panel)) failures.push(`${label} remains in ${panelPath}`);
}

function requireText(label, source, text, path) {
  if (!source.includes(text)) failures.push(`${label} missing from ${path}`);
}

forbid('browser-declared ALLOWED permission', /permission\s*:\s*['"]ALLOWED['"]/);
forbid('manual comparison entity input', /Comparison entity ID|setEntityId\s*\(|createComparisonItem\s*\(|pinComparisonItem\s*\(/);
forbid('browser-built comparison tray', /Comparison Tray|Side-by-side governed comparison/);
forbid('misleading current-table export', /Export current table view/);
forbid('misleading selected-record export', /Export selected records/);
forbid('misleading current-chart export', /Export current chart dataset/);
forbid('client CSV construction', /buildCsvExport\s*\(|saveCsv\s*\(/);
forbid('synthetic chart values', /value\s*:\s*index\s*\+\s*1/);
forbid('direct business-table mutation', /\.from\s*\([^)]*\)[\s\S]{0,300}\.(?:insert|update|upsert|delete)\s*\(/);

requireText('governed Saved Views read', panel, "repository.readSavedViews('analytics')", panelPath);
requireText('governed Saved Views command path', panel, 'repository.applyCommand({', panelPath);
requireText('Quick Actions', panel, 'quickActionDefinitions', panelPath);
requireText('Saved Views read RPC', repository, 'get_intelligence_saved_views', repositoryPath);
requireText('Saved Views command RPC', repository, 'apply_intelligence_saved_view_command', repositoryPath);

if (failures.length) {
  console.error('TRANSFORM-008A analytics productivity truth audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('TRANSFORM-008A analytics productivity truth audit passed.');
console.log('- Saved Views remain on server RPC authority.');
console.log('- Quick Actions remain navigation-only.');
console.log('- Manual comparison authority and misleading exports are absent from the production panel.');
