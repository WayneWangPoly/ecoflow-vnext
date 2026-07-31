export type SyncScopeMap = Record<string, string>;

export type SyncChange = {
  scope: string;
  payload: unknown;
  expectedRevision?: number;
};

export type SyncRow = {
  business_day: string;
  scope: string;
  payload: unknown;
  updated_at: string;
  revision?: number | string | null;
};

export type SyncPushResult<Row extends SyncRow> = {
  rows?: Row[];
  conflict?: boolean;
  detail?: string;
};

export type SerialSyncStatus = 'live' | 'error' | 'denied';

type StateUpdater<State> = (current: State) => State;

export type SerialSyncSessionOptions<State, Row extends SyncRow> = {
  businessDay: string;
  initialCursor: string;
  getDeviceLabel: () => string;
  getState: () => State;
  updateState: (updater: StateUpdater<State>) => void;
  normalizeState: (state: State, businessDay: string) => State;
  scopesFromState: (state: State) => SyncScopeMap;
  diffScopes: (previous: SyncScopeMap, current: SyncScopeMap) => SyncChange[];
  mergeRows: (state: State, rows: Row[]) => State;
  /** First hydration is a full server snapshot and must replace device cache. */
  replaceStateFromRows?: (state: State, rows: Row[]) => State;
  fetchRows: (businessDay: string, cursor: string) => Promise<Row[]>;
  advanceCursor?: (currentCursor: string, rows: Row[]) => string;
  pushRows: (
    businessDay: string,
    changes: SyncChange[],
    deviceLabel: string
  ) => Promise<void | SyncPushResult<Row>>;
  onStatus: (status: SerialSyncStatus, detail?: string) => void;
};

function errorDetail(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function errorStatus(reason: unknown) {
  if (!reason || typeof reason !== 'object' || !('status' in reason)) return undefined;
  const status = (reason as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function serializeChanges(changes: SyncChange[]) {
  return JSON.stringify(changes.map(({ scope, payload }) => ({ scope, payload })));
}

function revisionValue(value: SyncRow['revision']) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Serialises polling and writes for one business-day epoch.
 *
 * The server owns the initial snapshot, per-scope revisions and idempotent
 * command outcome. Device state is only a render/offline cache. A stale device
 * receives a conflict snapshot and never silently overwrites a newer scope.
 */
export class SerialSyncSession<State, Row extends SyncRow> {
  readonly businessDay: string;

  private readonly options: SerialSyncSessionOptions<State, Row>;
  private cursor: string;
  private lastKnown: SyncScopeMap = {};
  private knownRevision: Record<string, number> = {};
  private hydrated = false;
  private stopped = false;
  private deniedSignature = '';
  private tail: Promise<void> = Promise.resolve();
  private pollPromise: Promise<void> | null = null;
  private pushPromise: Promise<void> | null = null;
  private pushRequested = false;

  constructor(options: SerialSyncSessionOptions<State, Row>) {
    this.options = options;
    this.businessDay = options.businessDay;
    this.cursor = options.initialCursor;
  }

  isHydrated() {
    return this.hydrated;
  }

  stop() {
    this.stopped = true;
    this.pushRequested = false;
  }

  private enqueue(task: () => Promise<void>) {
    const run = async () => {
      if (this.stopped) return;
      await task();
    };
    const scheduled = this.tail.then(run, run);
    this.tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  private rememberRows(rows: Row[]) {
    for (const row of rows) {
      this.lastKnown[row.scope] = JSON.stringify(row.payload);
      this.knownRevision[row.scope] = revisionValue(row.revision);
    }
  }

  requestPoll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pollPromise) return this.pollPromise;

    const task = this.enqueue(async () => {
      const wasHydrated = this.hydrated;
      try {
        const fetched = await this.options.fetchRows(this.businessDay, this.cursor);
        if (this.stopped) return;

        const rows = fetched.filter((row) => row.business_day === this.businessDay);
        if (rows.length > 0) {
          this.cursor = this.options.advanceCursor
            ? this.options.advanceCursor(this.cursor, rows)
            : rows.reduce(
              (latest, row) => row.updated_at.localeCompare(latest) > 0 ? row.updated_at : latest,
              this.cursor
            );
        }

        if (!wasHydrated && this.options.replaceStateFromRows) {
          this.lastKnown = {};
          this.knownRevision = {};
          this.rememberRows(rows);
          this.options.updateState((current) => {
            const normalised = this.options.normalizeState(current, this.businessDay);
            return this.options.replaceStateFromRows!(normalised, rows);
          });
        } else {
          let applicableRows = rows;
          if (wasHydrated && rows.length > 0) {
            const local = this.options.normalizeState(this.options.getState(), this.businessDay);
            const currentScopes = this.options.scopesFromState(local);
            const dirtyScopes = new Set(
              this.options.diffScopes(this.lastKnown, currentScopes).map((change) => change.scope)
            );
            applicableRows = rows.filter((row) => !dirtyScopes.has(row.scope));
          }

          this.rememberRows(applicableRows);
          if (applicableRows.length > 0) {
            this.options.updateState((current) => {
              const normalised = this.options.normalizeState(current, this.businessDay);
              return this.options.mergeRows(normalised, applicableRows);
            });
          }
        }

        this.hydrated = true;
        this.options.onStatus(this.deniedSignature ? 'denied' : 'live');
      } catch (reason) {
        if (this.stopped) return;
        this.options.onStatus('error', errorDetail(reason));
      }
    });

    this.pollPromise = task;
    const clearPoll = () => {
      if (this.pollPromise === task) this.pollPromise = null;
    };
    void task.then(clearPoll, clearPoll);
    return task;
  }

  requestPush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.pushRequested = true;
    if (this.pushPromise) return this.pushPromise;

    const task = this.enqueue(async () => {
      try {
        while (this.pushRequested && !this.stopped) {
          this.pushRequested = false;
          if (!this.hydrated) break;

          const current = this.options.normalizeState(this.options.getState(), this.businessDay);
          const changes = this.options.diffScopes(
            this.lastKnown,
            this.options.scopesFromState(current)
          );
          if (changes.length === 0) continue;

          const signature = serializeChanges(changes);
          if (this.deniedSignature === signature) {
            this.options.onStatus('denied');
            continue;
          }

          const versionedChanges = changes.map((change) => ({
            ...change,
            expectedRevision: this.knownRevision[change.scope] ?? 0
          }));

          try {
            const result = await this.options.pushRows(
              this.businessDay,
              versionedChanges,
              this.options.getDeviceLabel()
            );
            if (this.stopped) return;

            const returnedRows = result?.rows ?? [];
            if (result?.conflict) {
              this.rememberRows(returnedRows);
              if (returnedRows.length > 0) {
                this.options.updateState((latest) => {
                  const normalised = this.options.normalizeState(latest, this.businessDay);
                  return this.options.mergeRows(normalised, returnedRows);
                });
              }
              this.deniedSignature = '';
              this.options.onStatus(
                'error',
                result.detail || 'A newer server update was kept. Review the latest state and repeat the action if still required.'
              );
              break;
            }

            if (returnedRows.length > 0) {
              this.rememberRows(returnedRows);
              const sentByScope = new Map(versionedChanges.map((change) => [change.scope, JSON.stringify(change.payload)]));
              const latestScopes = this.options.scopesFromState(
                this.options.normalizeState(this.options.getState(), this.businessDay)
              );
              const safeToMerge = returnedRows.filter((row) => latestScopes[row.scope] === sentByScope.get(row.scope));
              if (safeToMerge.length > 0) {
                this.options.updateState((latest) => {
                  const normalised = this.options.normalizeState(latest, this.businessDay);
                  return this.options.mergeRows(normalised, safeToMerge);
                });
              }
            } else {
              // Backward-compatible fallback for tests or a legacy adapter. The
              // production adapter always returns authoritative revisions.
              for (const change of versionedChanges) {
                this.lastKnown[change.scope] = JSON.stringify(change.payload);
                this.knownRevision[change.scope] = (change.expectedRevision ?? 0) + 1;
              }
            }

            this.deniedSignature = '';
            this.options.onStatus('live');
          } catch (reason) {
            if (this.stopped) return;
            const status = errorStatus(reason);
            if (status === 401 || status === 403) {
              this.deniedSignature = signature;
              this.options.onStatus('denied', errorDetail(reason));
            } else {
              this.options.onStatus('error', errorDetail(reason));
            }
            break;
          }
        }
      } catch (reason) {
        if (!this.stopped) this.options.onStatus('error', errorDetail(reason));
      }
    });

    this.pushPromise = task;
    const clearPush = () => {
      if (this.pushPromise === task) this.pushPromise = null;
      if (this.pushRequested && !this.stopped) void this.requestPush();
    };
    void task.then(clearPush, clearPush);
    return task;
  }
}
