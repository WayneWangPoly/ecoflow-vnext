import assert from 'node:assert/strict';
import test from 'node:test';
import { SerialSyncSession } from '../src/app/serialSyncSession.ts';

const EPOCH = '1970-01-01T00:00:00.000Z';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function row(businessDay, scope, payload, updatedAt) {
  return {
    business_day: businessDay,
    scope,
    payload,
    updated_at: updatedAt
  };
}

function harness({
  businessDay = '2026-07-27',
  initialState,
  fetchRows = async () => [],
  pushRows = async () => undefined
} = {}) {
  let state = initialState ?? { businessDay, scopes: {} };
  const statuses = [];
  let updates = 0;

  const session = new SerialSyncSession({
    businessDay,
    initialCursor: EPOCH,
    getDeviceLabel: () => 'Test device',
    getState: () => state,
    updateState: (updater) => {
      state = updater(state);
      updates += 1;
    },
    normalizeState: (current, expectedDay) => (
      current.businessDay === expectedDay
        ? current
        : { businessDay: expectedDay, scopes: {} }
    ),
    scopesFromState: (current) => current.scopes,
    diffScopes: (previous, current) => {
      const changes = [];
      for (const [scope, payload] of Object.entries(current)) {
        if (previous[scope] !== payload) {
          changes.push({ scope, payload: JSON.parse(payload) });
        }
      }
      return changes;
    },
    mergeRows: (current, rows) => ({
      ...current,
      scopes: {
        ...current.scopes,
        ...Object.fromEntries(rows.map((item) => [item.scope, JSON.stringify(item.payload)]))
      }
    }),
    fetchRows,
    pushRows,
    onStatus: (status, detail) => statuses.push({ status, detail })
  });

  return {
    session,
    statuses,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    getUpdates: () => updates
  };
}

test('a failed first fetch never hydrates or blind-pushes local state', async () => {
  let pushes = 0;
  const sync = harness({
    initialState: {
      businessDay: '2026-07-27',
      scopes: { 'run:A:task:SKU-1': '{"status":"PICKED"}' }
    },
    fetchRows: async () => {
      throw new Error('offline');
    },
    pushRows: async () => {
      pushes += 1;
    }
  });

  await sync.session.requestPoll();
  await sync.session.requestPush();

  assert.equal(sync.session.isHydrated(), false);
  assert.equal(pushes, 0);
  assert.deepEqual(sync.statuses, [{ status: 'error', detail: 'offline' }]);
});

test('a stale business-day session cannot apply its late response', async () => {
  const pending = deferred();
  const sync = harness({ fetchRows: () => pending.promise });

  const poll = sync.session.requestPoll();
  sync.session.stop();
  pending.resolve([
    row('2026-07-27', 'run:A:task:SKU-1', { status: 'PICKED' }, '2026-07-27T01:00:00Z')
  ]);
  await poll;

  assert.equal(sync.session.isHydrated(), false);
  assert.equal(sync.getUpdates(), 0);
  assert.deepEqual(sync.statuses, []);
});

test('overlapping poll requests share one in-flight fetch', async () => {
  const pending = deferred();
  let fetches = 0;
  const sync = harness({
    fetchRows: async () => {
      fetches += 1;
      return pending.promise;
    }
  });

  const first = sync.session.requestPoll();
  const second = sync.session.requestPoll();
  pending.resolve([]);
  await Promise.all([first, second]);

  assert.equal(fetches, 1);
  assert.equal(sync.session.isHydrated(), true);
});

test('a new epoch normalises state before applying remote rows', async () => {
  const sync = harness({
    businessDay: '2026-07-28',
    initialState: {
      businessDay: '2026-07-27',
      scopes: { 'run:A:task:OLD': '{"status":"PICKED"}' }
    },
    fetchRows: async () => [
      row('2026-07-28', 'run:A:task:NEW', { status: 'PENDING' }, '2026-07-28T01:00:00Z')
    ]
  });

  await sync.session.requestPoll();

  assert.deepEqual(sync.getState(), {
    businessDay: '2026-07-28',
    scopes: { 'run:A:task:NEW': '{"status":"PENDING"}' }
  });
});

test('poll and push are serial, and a late poll cannot overwrite a dirty local scope', async () => {
  const latePoll = deferred();
  const events = [];
  let fetchCount = 0;
  const pushed = [];
  const sync = harness({
    fetchRows: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return [
          row('2026-07-27', 'run:A:task:SKU-1', { status: 'PENDING' }, '2026-07-27T01:00:00Z')
        ];
      }
      events.push('poll:start');
      const rows = await latePoll.promise;
      events.push('poll:end');
      return rows;
    },
    pushRows: async (_day, changes) => {
      events.push('push:start');
      pushed.push(changes);
      events.push('push:end');
    }
  });

  await sync.session.requestPoll();
  sync.setState({
    businessDay: '2026-07-27',
    scopes: { 'run:A:task:SKU-1': '{"status":"PICKED"}' }
  });

  const poll = sync.session.requestPoll();
  const push = sync.session.requestPush();
  latePoll.resolve([
    row('2026-07-27', 'run:A:task:SKU-1', { status: 'PENDING' }, '2026-07-27T01:01:00Z')
  ]);
  await Promise.all([poll, push]);

  assert.deepEqual(events, ['poll:start', 'poll:end', 'push:start', 'push:end']);
  assert.equal(sync.getState().scopes['run:A:task:SKU-1'], '{"status":"PICKED"}');
  assert.deepEqual(pushed, [[{
    scope: 'run:A:task:SKU-1',
    payload: { status: 'PICKED' }
  }]]);
});

test('local changes arriving during a write are sent afterwards in order', async () => {
  const firstPush = deferred();
  const payloads = [];
  let pushCount = 0;
  const sync = harness({
    pushRows: async (_day, changes) => {
      pushCount += 1;
      payloads.push(changes[0].payload);
      if (pushCount === 1) await firstPush.promise;
    }
  });

  await sync.session.requestPoll();
  sync.setState({
    businessDay: '2026-07-27',
    scopes: { 'run:A:task:SKU-1': '{"status":"PICKING"}' }
  });
  const first = sync.session.requestPush();

  await Promise.resolve();
  sync.setState({
    businessDay: '2026-07-27',
    scopes: { 'run:A:task:SKU-1': '{"status":"PICKED"}' }
  });
  void sync.session.requestPush();
  firstPush.resolve();
  await first;

  assert.deepEqual(payloads, [
    { status: 'PICKING' },
    { status: 'PICKED' }
  ]);
});

test('an authorisation denial is not retried until the local changeset changes', async () => {
  let attempts = 0;
  const sync = harness({
    pushRows: async () => {
      attempts += 1;
      if (attempts === 1) {
        const failure = new Error('forbidden');
        failure.status = 403;
        throw failure;
      }
    }
  });

  await sync.session.requestPoll();
  sync.setState({
    businessDay: '2026-07-27',
    scopes: { 'run:A:task:SKU-1': '{"status":"PICKING"}' }
  });
  await sync.session.requestPush();
  await Promise.resolve();
  await sync.session.requestPush();
  assert.equal(attempts, 1);

  sync.setState({
    businessDay: '2026-07-27',
    scopes: { 'run:A:task:SKU-1': '{"status":"PICKED"}' }
  });
  await sync.session.requestPush();
  assert.equal(attempts, 2);
});
