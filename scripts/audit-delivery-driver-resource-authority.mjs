import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260809224000_delivery_driver_resource_authority.sql', 'utf8');
const pod = fs.readFileSync('src/data/repositories/deliveryPodQuality.ts', 'utf8');
const dispatch = fs.readFileSync('supabase/functions/delivery-notification-dispatch/index.ts', 'utf8');
const routeStart = fs.readFileSync('supabase/functions/notify-route-start/index.ts', 'utf8');

function has(text, needle, message) {
  if (!text.includes(needle)) throw new Error(message);
}
function lacks(text, needle, message) {
  if (text.includes(needle)) throw new Error(message);
}
function before(text, first, second, message) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  if (a < 0 || b < 0 || a >= b) throw new Error(message);
}

has(migration, 'ecoflow_authorize_delivery_resource', 'Canonical route/order resource authorization helper is missing.');
has(migration, 'assigned_driver_user_id<>auth.uid()', 'Driver resource authorization must bind to auth.uid().');
has(migration, 'ecoflow_resolve_assigned_delivery_order_by_box', 'BOX lookup must resolve through assigned route authority.');
has(migration, 'ecoflow_can_read_day_scope', 'Driver shared-state reads must be assignment filtered.');
has(migration, 'ecoflow_can_write_assigned_pod_path', 'POD storage writes must be route/order scoped.');
has(migration, 'ecoflow_queue_delivery_notifications_pre_resource_authority_20260809', 'Legacy notification primitive must be private behind resource authority.');
has(migration, 'ecoflow_record_delivery_exception_pre_resource_authority_20260809', 'Legacy exception primitive must be private behind resource authority.');
has(migration, 'ecoflow_record_driver_location_sample_pre_resource_authority_20260809', 'Legacy location primitive must be private behind resource authority.');
has(migration, 'ecoflow_record_driver_departure_acknowledgement_pre_resource_authority_20260809', 'Legacy departure primitive must be private behind resource authority.');

has(pod, "rpc('ecoflow_resolve_assigned_delivery_order_by_box'", 'Driver BOX lookup must call the assignment-aware RPC.');
lacks(pod, ".from('ecoflow_day_state')", 'POD/exception helper must not bypass route authority via direct day-state meta reads.');

has(dispatch, "const anonKey = Deno.env.get('SUPABASE_ANON_KEY')", 'Service-role dispatch must also create a user-scoped auth client.');
has(dispatch, "if (!authHeader.startsWith('Bearer '))", 'Notification dispatch must reject missing bearer tokens.');
has(dispatch, 'await userClient.auth.getUser()', 'Notification dispatch must validate the caller session.');
has(dispatch, "userClient.rpc('ecoflow_authorize_delivery_resource'", 'Notification dispatch must authorize its day/order resource before service-role effects.');
has(dispatch, 'SCOPED_DELIVERY_RESOURCE_REQUIRED', 'Notification dispatch must reject unscoped batch requests.');
has(dispatch, 'safePodPath(row, row.pod2_path)', 'Service-role POD signing must validate path ownership.');
before(dispatch, "await userClient.auth.getUser()", ".from('ecoflow_delivery_notifications')\n    .select('*')", 'Service-role notification query must occur only after user authentication.');

has(routeStart, "userClient.rpc('ecoflow_authorize_delivery_resource'", 'Route-start notification must authorize assigned route.');
has(routeStart, 'const orderIds = [...new Set((resource.snapshot?.stops ?? [])', 'Route-start order set must come from the authoritative snapshot.');
has(routeStart, ".eq('scope', `run:${resource.run_code}:route`)", 'Route-start notification must verify authoritative route-start state.');
has(routeStart, 'AUTHORITATIVE_ROUTE_NOT_STARTED', 'Premature route-start notification must fail closed.');
lacks(routeStart, '(body.orderIds ?? [])', 'Route-start notification must not trust browser-supplied order membership.');
lacks(routeStart, 'const startedAt = clean(body.startedAt)', 'Route-start notification must not trust browser-supplied start time.');

console.log('TRANSFORM-006 Driver resource authority static audit passed.');
