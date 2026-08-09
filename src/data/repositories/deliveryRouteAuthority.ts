import type { SupabaseClient } from '@supabase/supabase-js';
import type { DriverRun, MapPoint, RunStop } from '@/domain/driverRun';
import { supabase } from '@/lib/supabaseClient';

export type LockedDeliveryRouteSnapshot = {
  version: 1;
  businessDay: string;
  runCode: string;
  routeId: string;
  routeLabel: string;
  totalCartons: number;
  readyStops: number;
  warehousePoint: MapPoint;
  geoProjected: boolean;
  stops: RunStop[];
};

export type LockedDeliveryRouteRecord = {
  routeSnapshotId: string;
  businessDay: string;
  runCode: string;
  revision: number;
  snapshot: LockedDeliveryRouteSnapshot;
  assignedDriverUserId: string;
  assignedDriverLabel: string;
  approvedBy: string;
  approvedAt: string;
};

function requireClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || error);
  return String(error);
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function routeSnapshot(value: unknown): LockedDeliveryRouteSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Approved route snapshot is malformed.');
  const raw = value as Record<string, unknown>;
  const stops = Array.isArray(raw.stops) ? raw.stops : [];
  if (raw.version !== 1 || typeof raw.businessDay !== 'string' || typeof raw.runCode !== 'string' || !stops.length) {
    throw new Error('Approved route snapshot is incomplete. Ask office to re-approve the route.');
  }
  return raw as unknown as LockedDeliveryRouteSnapshot;
}

function record(row: Record<string, unknown>): LockedDeliveryRouteRecord {
  const snapshot = routeSnapshot(row.snapshot);
  const revision = finiteNumber(row.revision);
  const assignedDriverUserId = String(row.assigned_driver_user_id || '');
  const assignedDriverLabel = String(row.assigned_driver_label || '');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Approved route revision is invalid.');
  if (!assignedDriverUserId || !assignedDriverLabel) throw new Error('Approved route has no active Driver assignment. Ask office to re-approve the route.');
  return {
    routeSnapshotId: String(row.route_snapshot_id || ''),
    businessDay: String(row.business_day || snapshot.businessDay),
    runCode: String(row.run_code || snapshot.runCode),
    revision,
    snapshot,
    assignedDriverUserId,
    assignedDriverLabel,
    approvedBy: String(row.approved_by || ''),
    approvedAt: String(row.approved_at || ''),
  };
}

export function buildLockedDeliveryRouteSnapshot(run: DriverRun, runCode: string): LockedDeliveryRouteSnapshot {
  const code = runCode.trim().toUpperCase();
  if (!code) throw new Error('Run code is required before route approval.');
  if (!run.stops.length) throw new Error('At least one delivery stop is required before route approval.');
  return {
    version: 1,
    businessDay: run.businessDay,
    runCode: code,
    routeId: run.id,
    routeLabel: run.label,
    totalCartons: run.totalCartons,
    readyStops: run.readyStops,
    warehousePoint: { ...run.warehousePoint },
    geoProjected: run.geoProjected,
    stops: run.stops.map((stop, index) => ({
      ...stop,
      stopNumber: index + 1,
      mapPoint: { ...stop.mapPoint },
      lines: stop.lines.map((line) => ({ ...line })),
    })),
  };
}

export function driverRunFromLockedSnapshot(snapshot: LockedDeliveryRouteSnapshot): DriverRun {
  return {
    id: snapshot.routeId,
    label: snapshot.routeLabel,
    businessDay: snapshot.businessDay,
    stops: snapshot.stops.map((stop) => ({
      ...stop,
      mapPoint: { ...stop.mapPoint },
      lines: stop.lines.map((line) => ({ ...line })),
    })),
    totalCartons: snapshot.totalCartons,
    readyStops: snapshot.readyStops,
    warehousePoint: { ...snapshot.warehousePoint },
    geoProjected: snapshot.geoProjected,
  };
}

export async function lockDeliveryRouteSnapshot(
  input: {
    businessDay: string;
    runCode: string;
    assignedDriverUserId: string;
    snapshot: LockedDeliveryRouteSnapshot;
  },
  client?: SupabaseClient | null,
) {
  const active = requireClient(client);
  const driverId = input.assignedDriverUserId.trim();
  if (!driverId) throw new Error('Choose an active Driver before approving the route.');
  const { data, error } = await active.rpc('ecoflow_lock_delivery_route_snapshot_v2', {
    p_business_day: input.businessDay,
    p_run_code: input.runCode,
    p_assigned_driver_user_id: driverId,
    p_snapshot: input.snapshot,
  });
  if (error) throw new Error(message(error));
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('Route approval returned no authoritative snapshot.');
  return record(row as Record<string, unknown>);
}

export async function unlockDeliveryRouteSnapshot(
  input: { businessDay: string; runCode: string; reason?: string | null },
  client?: SupabaseClient | null,
) {
  const active = requireClient(client);
  const { data, error } = await active.rpc('ecoflow_unlock_delivery_route_snapshot', {
    p_business_day: input.businessDay,
    p_run_code: input.runCode,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(message(error));
  return Array.isArray(data) ? data : [];
}

export async function loadLockedDeliveryRouteSnapshot(
  input: { businessDay: string; runCode: string },
  client?: SupabaseClient | null,
): Promise<LockedDeliveryRouteRecord | null> {
  const active = requireClient(client);
  const { data, error } = await active.rpc('ecoflow_get_assigned_delivery_route_snapshot', {
    p_business_day: input.businessDay,
    p_run_code: input.runCode,
  });
  if (error) throw new Error(message(error));
  const row = Array.isArray(data) ? data[0] : null;
  return row ? record(row as Record<string, unknown>) : null;
}
