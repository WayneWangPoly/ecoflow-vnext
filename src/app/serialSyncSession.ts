export type SyncScopeMap = Record<string, string>;

export type SyncChange = {
  scope: string;
  payload: unknown;
};

export type SyncRow = {
  business_day: string;
  scope: string;
  payload: unknown;
  updated_at: string;
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
  fetchRows: (businessDay: string, cursor: string) => Promise<Row[]>;
  pushRows: (businessDay: string, changes: SyncChange[], deviceLabel: string) => Promise<void>;
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
  return JSON.stringify(changes);
}

/**
 * Serialises polling and writes for one business-day epoch.
 *
 * This is deliberately a client-side safety boundary, not a cross-device
 * concurrency protocol. Server-side revisions and idempotent commands remain
 * the authoritative long-term design.
 */
export class SerialSyncSession<State, Row extends SyncRow> {
  readonly businessDay: string;

  private readonly options: SerialSyncSessionOptions<State, Row>;
  private cursor: string;
  private lastKnown: SyncScopeMap = {};
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
          this.cursor = rows.reduce(
            (latest, row) => row.updated_at.localeCompare(latest) > 0 ? row.updated_at : latest,
            this.cursor
          );
        }

        let applicableRows = rows;
        if (wasHydrated && rows.length > 0) {
          const local = this.options.normalizeState(this.options.getState(), this.businessDay);
          const currentScopes = this.options.scopesFromState(local);
          const dirtyScopes = new Set(
            this.options.diffScopes(this.lastKnown, currentScopes).map((change) => change.scope)
          );
          applicableRows = rows.filter((row) => !dirtyScopes.has(row.scope));
        }

        for (const row of applicableRows) {
          this.lastKnown[row.scope] = JSON.stringify(row.payload);
        }
        if (applicableRows.length > 0) {
          this.options.updateState((current) => {
            const normalised = this.options.normalizeState(current, this.businessDay);
            return this.options.mergeRows(normalised, applicableRows);
          });
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

          try {
            await this.options.pushRows(
              this.businessDay,
              changes,
              this.options.getDeviceLabel()
            );
            if (this.stopped) return;
            for (const change of changes) {
              this.lastKnown[change.scope] = JSON.stringify(change.payload);
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
