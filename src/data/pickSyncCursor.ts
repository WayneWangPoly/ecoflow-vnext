export type CursorRow = {
  updated_at: string;
  change_seq?: number | string | null;
};

const EPOCH_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const SEQUENCE_PREFIX = 'seq:';
const TIMESTAMP_PREFIX = 'time:';

export const INITIAL_PICK_SYNC_CURSOR = `${SEQUENCE_PREFIX}0`;

export function sequenceFromPickSyncCursor(cursor: string): bigint | null {
  if (!cursor.startsWith(SEQUENCE_PREFIX)) return null;
  const value = cursor.slice(SEQUENCE_PREFIX.length);
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

export function timestampFromPickSyncCursor(cursor: string): string {
  if (!cursor.startsWith(TIMESTAMP_PREFIX)) return EPOCH_TIMESTAMP;
  const value = cursor.slice(TIMESTAMP_PREFIX.length);
  return Number.isNaN(Date.parse(value)) ? EPOCH_TIMESTAMP : value;
}

function rowSequence(row: CursorRow): bigint | null {
  const value = row.change_seq;
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

export function comparePickSyncRows(left: CursorRow, right: CursorRow): number {
  const leftSequence = rowSequence(left);
  const rightSequence = rowSequence(right);
  if (leftSequence !== null && rightSequence !== null) {
    if (leftSequence < rightSequence) return -1;
    if (leftSequence > rightSequence) return 1;
    return 0;
  }
  return left.updated_at.localeCompare(right.updated_at);
}

/**
 * Prefer the server's monotonic change sequence. Timestamp cursors remain only
 * as a rolling-deploy fallback while the new column reaches production.
 */
export function advancePickSyncCursor(currentCursor: string, rows: CursorRow[]): string {
  const currentSequence = sequenceFromPickSyncCursor(currentCursor) ?? 0n;
  const sequences = rows
    .map(rowSequence)
    .filter((value): value is bigint => value !== null);
  if (sequences.length > 0) {
    const latest = sequences.reduce((maximum, value) => value > maximum ? value : maximum, currentSequence);
    return `${SEQUENCE_PREFIX}${latest.toString()}`;
  }

  const currentTimestamp = timestampFromPickSyncCursor(currentCursor);
  const latestTimestamp = rows.reduce(
    (latest, row) => row.updated_at.localeCompare(latest) > 0 ? row.updated_at : latest,
    currentTimestamp
  );
  return `${TIMESTAMP_PREFIX}${latestTimestamp}`;
}
