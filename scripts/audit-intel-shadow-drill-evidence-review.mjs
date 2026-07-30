import assert from 'node:assert/strict';
import fs from 'node:fs';

const componentPath = 'src/features/intelligence/crossFilter/ShadowDrillEvidenceReview.tsx';
const presentationPath = 'src/features/intelligence/crossFilter/shadowDrillEvidencePresentationContract.ts';
const stylePath = 'src/features/intelligence/crossFilter/shadowDrillEvidenceReview.css';
const testPath = 'scripts/intel-shadow-drill-evidence-review-contract.test.mjs';
const workspacePath = 'src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx';
const indexPath = 'src/features/intelligence/crossFilter/index.ts';
const packagePath = 'package.json';

for (const file of [componentPath, presentationPath, stylePath, testPath, workspacePath, indexPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing Shadow evidence review file: ${file}`);
}

const component = fs.readFileSync(componentPath, 'utf8');
const presentation = fs.readFileSync(presentationPath, 'utf8');
const style = fs.readFileSync(stylePath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const workspace = fs.readFileSync(workspacePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const designTokens = fs.readFileSync('src/features/intelligence/designSystem/tokens.css', 'utf8');
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const pulse = fs.readFileSync('src/features/intelligence/operationalPulse/OperationalPulse.tsx', 'utf8');
const formalSurface = fs.readFileSync('src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  'ShadowDrillEvidenceReview',
  'repository = shadowDrillEvidenceRepository',
  'repository.readShadowDrillEvidence(request)',
  'shadowDrillEvidenceFailure(error)',
  'SHADOW REVIEW · NON-PRODUCTION',
  'Fill and substitution evidence',
  'Review evidence',
  'Affected orders',
  'AFFECTED ORDERS',
  'Open order',
  'shadowEvidenceOrderRoute(entity)',
  'navigate(route.href)',
  'No KPI percentage, target, production Drill authority or operational write.',
  '<option value="fill_rate">Fill Rate</option>',
  '<option value="substitution_rate">Substitution Rate</option>',
  '<option value="date">Delivery date</option>',
  '<option value="commercial_sku">Commercial SKU</option>',
  '<table className="ef-shadow-evidence__table">',
]) {
  assert.ok(component.includes(marker), `missing Shadow evidence review marker: ${marker}`);
}

assert.equal(
  (component.match(/repository\.readShadowDrillEvidence\(request\)/g) ?? []).length,
  1,
  'Shadow evidence review must issue one repository read per load',
);

for (const forbidden of [
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /get_initial_kpi_shadow_drill_evidence/,
  /get_initial_kpi_shadow_projection/,
  /get_metric_drill_access/,
  /metric_value/i,
  /numerator/i,
  /denominator/i,
  /fulfilled_quantity/i,
  /ordered_quantity/i,
  /line_total/i,
  /unit_price/i,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /CrossFilterDrillSurface/,
  /buildCrossFilterDrillModel/,
  /buildCrossFilterDrillPath/,
  /localStorage/,
  /sessionStorage/,
  /window\./,
  /document\./,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /setTimeout/,
  /setInterval/,
  /Math\.random/,
]) {
  assert.ok(!forbidden.test(component), `Shadow evidence review scope expansion: ${forbidden}`);
}

for (const marker of [
  'defaultShadowEvidenceDateRange',
  'shadowEvidenceMetricLabel',
  'shadowEvidenceDimensionLabel',
  'shadowEvidenceStatePresentation',
  'shadowEvidenceSummary',
  'shadowEvidenceOrderRoute',
  "workspace: matched.route.workspace",
  "primaryDrawer: `order:${entity.id}`",
  'withWorkspaceQuery(pathname, query)',
  "dateFrom: isoDate(end - (29 * DAY_MS))",
]) {
  assert.ok(presentation.includes(marker), `missing Shadow evidence presentation marker: ${marker}`);
}

for (const forbidden of [
  /react/i,
  /useNavigate/,
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /metric_value/i,
  /numerator/i,
  /denominator/i,
  /fulfilled_quantity/i,
  /ordered_quantity/i,
  /window\./,
  /document\./,
]) {
  assert.ok(!forbidden.test(presentation), `Shadow evidence presentation scope expansion: ${forbidden}`);
}

for (const marker of [
  '.ef-shadow-evidence__filters',
  '.ef-shadow-evidence__summary',
  '.ef-shadow-evidence__layout',
  '.ef-shadow-evidence__table',
  '.ef-shadow-evidence__entities',
  '.ef-shadow-evidence__boundary',
  '.ef-shadow-evidence__sr-only',
  '@media (max-width: 1080px)',
  '@media (max-width: 720px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `missing Shadow evidence style marker: ${marker}`);
}

for (const forbidden of ['!important', '@font-face', 'url(', '#root', '.orders-', '.inventory-', '.warehouse-', '.delivery-']) {
  assert.ok(!style.includes(forbidden), `Shadow evidence style scope expansion: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
const localTokens = new Set(
  Array.from(style.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(style.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  assert.ok(
    publishedTokens.has(reference) || localTokens.has(reference),
    `Shadow evidence review uses unpublished design token: ${reference}`,
  );
}

for (const testName of [
  'Shadow review defaults to a bounded thirty-day UTC range',
  'Shadow review labels metrics dimensions blockers and states explicitly',
  'Shadow review summary preserves bounded evidence counts without KPI arithmetic',
  'Shadow evidence Order handoff uses canonical route and drawer query state',
  'invalid route identity cannot become an operational handoff',
  'Shadow evidence moments are explicit and invalid timestamps do not look fresh',
]) {
  assert.ok(tests.includes(testName), `Shadow evidence review test missing: ${testName}`);
}

for (const marker of [
  "import { MetricDrillAccessStatus, ShadowDrillEvidenceReview } from '../crossFilter';",
  '<ShadowDrillEvidenceReview />',
]) {
  assert.ok(workspace.includes(marker), `Shadow evidence workspace adoption missing: ${marker}`);
}
assert.equal(
  (workspace.match(/<ShadowDrillEvidenceReview \/>/g) ?? []).length,
  1,
  'Analytics workspace must adopt the Shadow evidence review exactly once',
);
for (const forbidden of [
  'shadowDrillEvidenceRepository',
  'readShadowDrillEvidence',
  'shadowDrillEvidenceContract',
  'get_initial_kpi_shadow_drill_evidence',
]) {
  assert.ok(!workspace.includes(forbidden), `Analytics workspace directly couples to Shadow evidence data: ${forbidden}`);
}

for (const marker of [
  'ShadowDrillEvidenceReview',
  'ShadowDrillEvidenceReviewProps',
  'shadowEvidenceSummary',
  'shadowEvidenceOrderRoute',
  'defaultShadowEvidenceDateRange',
]) {
  assert.ok(index.includes(marker), `Shadow evidence review export missing: ${marker}`);
}

for (const forbidden of ['ShadowDrillEvidenceReview', 'shadowDrillEvidenceRepository', 'readShadowDrillEvidence']) {
  assert.ok(!dashboard.includes(forbidden), `Dashboard adopted Shadow evidence review: ${forbidden}`);
  assert.ok(!pulse.includes(forbidden), `Operational Pulse adopted Shadow evidence review: ${forbidden}`);
  assert.ok(!formalSurface.includes(forbidden), `Formal Drill Surface adopted Shadow evidence review: ${forbidden}`);
  assert.ok(!app.includes(forbidden), `App directly adopted Shadow evidence review: ${forbidden}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-shadow-drill-evidence-review.mjs')
    && frontendAudit.includes('intel-shadow-drill-evidence-review-contract.test.mjs'),
  'Shadow evidence review checks are not wired to audit:intel-frontend',
);

console.log('INTEL-UI-005E Shadow evidence review audit passed.');
