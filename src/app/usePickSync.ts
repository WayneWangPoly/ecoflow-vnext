import { useEffect, useRef, useState } from 'react';
import { loadDriverDayState } from '@/domain/driverRun';
import type { DriverDayState } from '@/domain/driverRun';
import {
  advancePickSyncCursor,
  diffScopes,
  fetchPickRows,
  INITIAL_PICK_SYNC_CURSOR,
  mergeRowsIntoDay,
  pickSyncAvailable,
  pushPickRows,
  replaceRowsIntoDay,
  scopesFromDay
} from '@/data/repositories/pickSync';
import type { PickSyncRow } from '@/data/repositories/pickSync';
import { SerialSyncSession } from './serialSyncSession';

export type PickSyncStatus = 'off' | 'connecting' | 'live' | 'error' | 'denied';

const POLL_MS = 4000;

let lastSyncErrorDetail = '';

/** Human-readable detail for the most recent sync failure (shown as chip tooltip). */
export function getPickSyncErrorDetail() {
  return lastSyncErrorDetail;
}

/**
 * Keeps driver, pick, route and shift scopes aligned with Supabase authority.
 *
 * The first successful poll replaces device cache with the complete server
 * snapshot. Subsequent writes use idempotent command IDs and per-scope CAS
 * revisions. A stale device receives the newer server payload instead of
 * overwriting it. localStorage remains only a fast/offline render cache.
 */
export function usePickSync(
  businessDay: string,
  day: DriverDayState,
  setDay: React.Dispatch<React.SetStateAction<DriverDayState>>,
  deviceLabel: string
): PickSyncStatus {
  const [status, setStatus] = useState<PickSyncStatus>(() => (pickSyncAvailable() ? 'connecting' : 'off'));
  const dayRef = useRef(day);
  const deviceLabelRef = useRef(deviceLabel);
  const sessionRef = useRef<SerialSyncSession<DriverDayState, PickSyncRow> | null>(null);

  dayRef.current = day;
  deviceLabelRef.current = deviceLabel;

  const updateDay = (updater: (current: DriverDayState) => DriverDayState) => {
    setDay((current) => {
      const next = updater(current);
      dayRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    sessionRef.current?.stop();
    if (!pickSyncAvailable()) {
      sessionRef.current = null;
      setStatus('off');
      return undefined;
    }

    lastSyncErrorDetail = '';
    setStatus('connecting');
    updateDay((current) => (
      current.businessDay === businessDay ? current : loadDriverDayState(businessDay)
    ));

    const session = new SerialSyncSession<DriverDayState, PickSyncRow>({
      businessDay,
      initialCursor: INITIAL_PICK_SYNC_CURSOR,
      getDeviceLabel: () => deviceLabelRef.current,
      getState: () => dayRef.current,
      updateState: updateDay,
      normalizeState: (current, expectedBusinessDay) => (
        current.businessDay === expectedBusinessDay
          ? current
          : loadDriverDayState(expectedBusinessDay)
      ),
      scopesFromState: scopesFromDay,
      diffScopes,
      mergeRows: mergeRowsIntoDay,
      replaceStateFromRows: replaceRowsIntoDay,
      fetchRows: fetchPickRows,
      advanceCursor: advancePickSyncCursor,
      pushRows: pushPickRows,
      onStatus: (next, detail) => {
        if (sessionRef.current !== session) return;
        if (detail) {
          lastSyncErrorDetail = next === 'denied'
            ? `Your role is not allowed to write this shared state. Ask the office to check role setup. ${detail}`
            : detail;
        }
        setStatus(next);
      }
    });
    sessionRef.current = session;

    void session.requestPoll();
    const timer = window.setInterval(() => void session.requestPoll(), POLL_MS);
    return () => {
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
      window.clearInterval(timer);
    };
  }, [businessDay, setDay]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!pickSyncAvailable() || !session || session.businessDay !== businessDay) return;
    if (day.businessDay !== businessDay || !session.isHydrated()) return;
    void session.requestPush();
  }, [day, businessDay, deviceLabel, status]);

  return status;
}
