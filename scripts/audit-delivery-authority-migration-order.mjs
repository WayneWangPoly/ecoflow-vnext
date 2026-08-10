import fs from 'node:fs';
import path from 'node:path';

const directory = 'supabase/migrations';
const anchor = '20260809224500_delivery_pod_business_day_guard.sql';
const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
const anchorIndex = files.indexOf(anchor);
if (anchorIndex < 0) throw new Error(`Authority anchor migration is missing: ${anchor}`);

const sensitivePatterns = [
  /create\s+or\s+replace\s+function\s+public\.ecoflow_authorize_delivery_resource\s*\(/i,
  /create\s+or\s+replace\s+function\s+public\.ecoflow_apply_day_state_commands\s*\(/i,
  /create\s+or\s+replace\s+function\s+public\.ecoflow_queue_delivery_notifications\s*\(/i,
  /create\s+or\s+replace\s+function\s+public\.ecoflow_record_delivery_exception\s*\(/i,
  /create\s+or\s+replace\s+function\s+public\.ecoflow_record_driver_location_sample\s*\(/i,
  /create\s+or\s+replace\s+function\s+public\.ecoflow_record_driver_departure_acknowledgement\s*\(/i,
  /create\s+policy\s+ecoflow_pod_/i,
  /ecoflow_day_state_active_read/i,
];

const later = files.slice(anchorIndex + 1);
const violations = [];
for (const file of later) {
  const text = fs.readFileSync(path.join(directory, file), 'utf8');
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      violations.push(`${file}: ${pattern}`);
    }
  }
}

if (violations.length) {
  throw new Error(
    'A migration later than the TRANSFORM-006 authority anchor redefines a protected Delivery/Driver boundary. ' +
    'Review it explicitly and move/update the authority contract instead of silently overriding it:\n' +
    violations.map((item) => ` - ${item}`).join('\n'),
  );
}

console.log(`TRANSFORM-006 migration-order authority audit passed. ${later.length} later migration(s) inspected.`);
