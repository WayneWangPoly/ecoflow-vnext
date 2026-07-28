import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advancePickSyncCursor,
  comparePickSyncRows,
  INITIAL_PICK_SYNC_CURSOR,
  sequenceFromPickSyncCursor,
  timestampFromPickSyncCursor
} from '../src/data/pickSyncCursor.ts';

test('sequence cursor advances deterministically across equal timestamps', () => {
  const timestamp = '2026-07-27T01:00:00.000Z';
  const cursor = advancePickSyncCursor(INITIAL_PICK_SYNC_CURSOR, [
    { updated_at: timestamp, change_seq: 41 },
    { updated_at: timestamp, change_seq: 43 },
    { updated_at: timestamp, change_seq: 42 }
  ]);

  assert.equal(cursor, 'seq:43');
  assert.equal(sequenceFromPickSyncCursor(cursor), 43n);
});

test('sequence cursor preserves bigint precision', () => {
  const cursor = advancePickSyncCursor('seq:9007199254740992', [
    {
      updated_at: '2026-07-27T01:00:00.000Z',
      change_seq: '9007199254740993'
    }
  ]);

  assert.equal(cursor, 'seq:9007199254740993');
});

test('sequenced rows merge in server order even when timestamps tie or move backwards', () => {
  const rows = [
    { updated_at: '2026-07-27T01:00:01.000Z', change_seq: 43 },
    { updated_at: '2026-07-27T01:00:00.000Z', change_seq: 42 },
    { updated_at: '2026-07-27T01:00:00.000Z', change_seq: 41 }
  ];

  assert.deepEqual(
    rows.sort(comparePickSyncRows).map((item) => item.change_seq),
    [41, 42, 43]
  );
});

test('rolling-deploy fallback overlaps the timestamp boundary', () => {
  const cursor = advancePickSyncCursor(INITIAL_PICK_SYNC_CURSOR, [
    { updated_at: '2026-07-27T01:00:00.000Z' },
    { updated_at: '2026-07-27T01:00:00.000Z' }
  ]);

  assert.equal(cursor, 'time:2026-07-27T01:00:00.000Z');
  assert.equal(timestampFromPickSyncCursor(cursor), '2026-07-27T01:00:00.000Z');
});

test('invalid or sequence cursors fall back to the Unix epoch for timestamp reads', () => {
  assert.equal(timestampFromPickSyncCursor('seq:99'), '1970-01-01T00:00:00.000Z');
  assert.equal(timestampFromPickSyncCursor('time:not-a-date'), '1970-01-01T00:00:00.000Z');
});
