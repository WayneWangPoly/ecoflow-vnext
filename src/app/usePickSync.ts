import { useEffect, useRef, useState } from 'react';
import type { DriverDayState } from '@/domain/driverRun';
import {
  diffScopes,
  fetchPickRows,
  mergeRowsIntoDay,
  pickSyncAvailable,
  pushPickRows,
  scopesFromDay
} from '@/data/repositories/pickSync';
import type { ScopeMap } from '@/data/repositories/pickSync';

export type PickSyncStatus = 'off' | 'connecting' | 'live' | 'error' | 'denied';

const POLL_MS = 4000;

let lastSyncErrorDetail = '';

/** Human-readable detail for the most recent sync failure (shown as chip tooltip). */
export function getPickSyncErrorDetail() {
  return lastSyncErrorDetail;
}

function serializeChanges(changes: { scope: string; payload: unknown }[]) {
  return JSON.stringify(changes);
}

/**
 * Keeps the pick slice of the driver day in sync through Supabase.
 * Local actions are pushed as per-scope upserts; remote rows are polled and
 * merged in. Everything degrades to local-only when Supabase is unreachable.
 *
 * Authorisation failures (RLS rejects the write for this role) do NOT retry
 * the same payload every poll: the rejected changeset is remembered and only
 * re-attempted once the local state actually changes, and the status surfaces
 * as 'denied' so the operator sees a permissions problem instead of a
 * silently hot-looping "sync error".
 */
export function usePickSync(
  businessDay: string,
  day: DriverDayState,
  setDay: React.Dispatch<React.SetStateAction<DriverDayState>>,
  deviceLabel: string
): PickSyncStatus {
  const [status, setStatus] = useState<PickSyncStatus>(() => (pickSyncAvailable() ? 'connecting' : 'off'));
  const lastKnown = useRef<ScopeMap>({});
  const cursor = useRef('1970-01-01T00:00:00.000Z');
  const hydrated = useRef(false);
  const deniedSignature = useRef('');

  useEffect(() => {
    if (!pickSyncAvailable()) return undefined;
    let active = true;
    const tick = async () => {
      try {
        const rows = await fetchPickRows(businessDay, cursor.current);
        if (!active) return;
        if (rows.length) {
          cursor.current = rows[rows.length - 1].updated_at;
          rows.forEach((row) => {
            lastKnown.current[row.scope] = JSON.stringify(row.payload);
          });
          setDay((current) => mergeRowsIntoDay(current, rows));
        }
        hydrated.current = true;
        setStatus((current) => (current === 'denied' ? current : 'live'));
      } catch (error) {
        if (!active) return;
        hydrated.current = true;
        lastSyncErrorDetail = error instanceof Error ? error.message : String(error);
        setStatus('error');
      }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [businessDay, setDay]);

  useEffect(() => {
    if (!pickSyncAvailable() || !hydrated.current) return;
    const current = scopesFromDay(day);
    const changes = diffScopes(lastKnown.current, current);
    if (!changes.length) return;
    const signature = serializeChanges(changes);
    // Do not hot-loop a changeset the server has already refused for this role.
    if (deniedSignature.current && deniedSignature.current === signature) return;
    pushPickRows(businessDay, changes, deviceLabel)
      .then(() => {
        deniedSignature.current = '';
        changes.forEach((change) => {
          lastKnown.current[change.scope] = JSON.stringify(change.payload);
        });
        setStatus('live');
      })
      .catch((error: Error & { status?: number }) => {
        lastSyncErrorDetail = error.message || String(error);
        if (error.status === 401 || error.status === 403) {
          deniedSignature.current = signature;
          lastSyncErrorDetail = `Your role is not allowed to write this shared state (HTTP ${error.status}). The change stays on this device; ask the office to check role setup. ${error.message}`;
          setStatus('denied');
        } else {
          setStatus('error');
        }
      });
  }, [day, businessDay, deviceLabel, status]);

  return status;
}
