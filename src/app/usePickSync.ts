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

export type PickSyncStatus = 'off' | 'connecting' | 'live' | 'error';

const POLL_MS = 4000;

/**
 * Keeps the pick slice of the driver day in sync through Supabase.
 * Local actions are pushed as per-scope upserts; remote rows are polled and
 * merged in. Everything degrades to local-only when Supabase is unreachable.
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
        setStatus('live');
      } catch {
        if (!active) return;
        hydrated.current = true;
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
    changes.forEach((change) => {
      lastKnown.current[change.scope] = JSON.stringify(change.payload);
    });
    pushPickRows(businessDay, changes, deviceLabel)
      .then(() => setStatus('live'))
      .catch(() => setStatus('error'));
  }, [day, businessDay, deviceLabel, status]);

  return status;
}
