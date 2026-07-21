import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const passes = [];

function requireText(file, text, label) {
  const content = read(file);
  if (!content.includes(text)) failures.push(`${label}: missing ${JSON.stringify(text)} in ${file}`);
  else passes.push(label);
}

function requirePattern(file, pattern, label) {
  const content = read(file);
  if (!pattern.test(content)) failures.push(`${label}: ${pattern} not found in ${file}`);
  else passes.push(label);
}

function forbidPattern(file, pattern, label) {
  const content = read(file);
  if (pattern.test(content)) failures.push(`${label}: forbidden ${pattern} found in ${file}`);
  else passes.push(label);
}

const catalogue = 'src/operational/guardedActionSpecs.ts';

requireText('src/main.tsx', '<OperationalSafetyCenter />', 'Operational safety center is globally mounted');
requireText('src/OperationalSafetyCenter.tsx', 'guardedButtonSpec(button)', 'Safety center delegates to the guarded action catalogue');
requireText(catalogue, 'Release selected orders to today’s run', 'Batch release uses an affected-object review');
requireText(catalogue, 'requireExactObjects: true', 'Bulk release and route approval fail closed when objects cannot be enumerated');
requireText('src/OperationalSafetyCenter.tsx', 'The interface could not enumerate all', 'Incomplete affected-object previews are visible and blocked');
requireText('src/app/App.tsx', 'Approve &amp; lock route', 'The real route approval control remains present');
requirePattern(catalogue, /approve\s\*\&\s\*/, 'Safety matcher recognises the real Approve & lock route label');
requireText('src/app/App.tsx', 'Unlock before picking', 'The real route unlock control remains present');
requireText(catalogue, 'unlock before picking', 'Safety matcher recognises the real route unlock label');
requireText(catalogue, 'Generate and send customer statement', 'Statement email dispatch is guarded');
requireText(catalogue, 'Change team role', 'Role changes are guarded');
requireText(catalogue, 'Create team login', 'Account creation is guarded');
requireText(catalogue, 'Reset team account password', 'Password reset is guarded');
requireText('src/OperationalSafetyCenter.tsx', 'I reviewed the affected object and impact.', 'Confirmation requires explicit acknowledgement');
requireText(catalogue, 'confirmToken', 'Bulk and destructive actions support typed confirmation');
requireText('src/ProductionWriteSafety.tsx', 'permanentlyBlockedPattern', 'Bulk internal-order creation is hard-disabled');
requireText('src/ProductionWriteSafety.tsx', "button.dataset.productionSafetyDisabled = 'permanent'", 'Internal-order guard cannot be re-enabled by live-data recovery');

requireText('src/AccountsStatementWorkbench.tsx', '>Promise</button>', 'Accounts exposes the promise action');
requireText('src/AccountsStatementWorkbench.tsx', '>Dispute</button>', 'Accounts exposes the dispute action');
requireText('src/AccountsStatementWorkbench.tsx', '>Hold</button>', 'Accounts exposes the operational hold action');
requireText('src/AccountsStatementWorkbench.tsx', '>Clear hold</button>', 'Accounts exposes the clear-hold action');
requireText(catalogue, 'Record promise to pay', 'Promise action is reviewed before recording');
requireText(catalogue, 'Record customer account dispute', 'Dispute action is reviewed before recording');
requireText(catalogue, 'Place customer account on operational hold', 'Hold action is reviewed before recording');
requireText(catalogue, "confirmToken: 'HOLD'", 'Hold requires typed confirmation');
requireText(catalogue, 'Clear customer operational hold', 'Clear hold is reviewed before recording');
requireText(catalogue, "confirmToken: 'CLEAR HOLD'", 'Clear hold requires typed confirmation');
requireText('supabase/migrations/20260711190000_commercial_controls.sql', "when la.latest_action='HOLD_ACCOUNT' then 'ON_HOLD'", 'Accounts queue derives ON HOLD from the latest hold action');
requireText('supabase/migrations/20260711190000_commercial_controls.sql', "when s.overdue_statement_value>0", 'Cleared holds return to invoice-derived priority');

requireText('src/enhancers/IndustrialDesktopWorkbench.tsx', 'WORKBENCH_SESSION_KEY', 'Work tabs use the session continuity key');
requireText('src/enhancers/IndustrialDesktopWorkbench.tsx', 'readWorkbenchSession()', 'Work tabs restore after refresh');
requireText('src/enhancers/IndustrialDesktopWorkbench.tsx', 'writeWorkbenchSession', 'Work tabs persist changes');
requireText('src/enhancers/IndustrialDesktopWorkbench.tsx', 'OPERATIONAL_SESSION_CLEARED', 'Work tabs clear on logout/session change');
requireText('src/enhancers/IndustrialDesktopWorkbench.tsx', 'Highest loaded value', 'Value sorting is explicitly scoped to loaded rows');
requirePattern('src/enhancers/IndustrialDesktopWorkbench.tsx', /\(value\|amount\|total\|revenue\|balance\|outstanding\|overdue\|due\)/, 'Value sort reads monetary columns rather than arbitrary order/date numbers');
forbidPattern('src/enhancers/IndustrialDesktopWorkbench.tsx', /match\(\/-\?\\d\+\(\?:\\\.\\d\+\)\?\/g\)/, 'Old arbitrary-number sort is removed');

requireText('src/operational/operationalActionJournal.ts', 'window.sessionStorage', 'Recent actions are session-scoped');
requireText('src/operational/operationalActionJournal.ts', 'WORKBENCH_SESSION_KEY', 'Logout clears work tabs and action history together');
requireText('src/operational/operationalActionJournal.ts', "latest.status === 'REQUESTED'", 'Review and confirmation update one action record');
requireText('src/operational/operationalActionJournal.ts', 'CONFIRM_RESULT_WINDOW_MS', 'Visible completion can attach to a recent confirmed action');
requireText('src/OperationalSafetyCenter.tsx', 'Recent actions', 'Recent actions are visible in the desktop top bar');
requireText('src/OperationalSafetyCenter.tsx', "status: failed ? 'FAILED' : 'SUCCEEDED'", 'Visible success and failure feedback enters the journal');

requireText('supabase/migrations/20260720070000_customer_operational_events.sql', "in ('OWNER','ADMIN','ACCOUNT','VIEWER')", 'Office roles can read customer operational records');
requireText('supabase/migrations/20260720070000_customer_operational_events.sql', "event_type = 'DELIVERY_INSTRUCTION'", 'Driver reads delivery instructions only');
requireText('supabase/migrations/20260720070000_customer_operational_events.sql', "= 'DRIVER'", 'Driver read policy is role-bound');
requireText('supabase/migrations/20260720070000_customer_operational_events.sql', "v_role not in ('OWNER','ADMIN','ACCOUNT')", 'Only office write roles can create customer events');

requireText('src/app/PickBoard.tsx', 'Scan the product barcode before picking.', 'Warehouse stock deduction still requires barcode scan');
requireText('src/app/PickBoard.tsx', 'pickWarehouseStock', 'Warehouse pick remains a server stock transaction');
requireText('src/app/DriverApp.tsx', 'pod1', 'Driver flow retains first POD evidence');
requireText('src/app/DriverApp.tsx', 'pod2', 'Driver flow retains second POD evidence');

requirePattern('src/operationalSafetyCenter.css', /@media \(max-width: 760px\)/, 'Confirmation and recent-action surfaces have a mobile breakpoint');
requirePattern('src/industrialDesktopWorkbench.css', /@media \(max-width: 1180px\)/, 'Workbench has a laptop breakpoint');
requirePattern('src/industrialDesktopWorkbench.css', /@media \(max-width: 900px\)/, 'Workbench has a narrow desktop breakpoint');
requireText('src/operationalContinuity.css', '.industrial-loaded-scope', 'Loaded-row scope remains visible on larger screens');

if (failures.length) {
  console.error(`Operational safety continuity audit failed (${failures.length}):`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`Operational safety continuity audit passed (${passes.length} contracts).`);
passes.forEach((pass) => console.log(` ✓ ${pass}`));
