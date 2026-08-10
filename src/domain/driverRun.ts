export * from './driverRunCore';

import { reconcileStopOrder as reconcileCoreStopOrder } from './driverRunCore';
import type { RunStop } from './driverRunCore';

type ExecutionOrderedStop = RunStop & {
  executionSequenceAuthoritative?: true;
};

/**
 * The immutable pick/label order and the Driver execution order are separate
 * authorities. Draft/warehouse callers keep the legacy saved-order behaviour.
 * A run reconstructed from the server's effective locked snapshot is already in
 * the authoritative Driver execution sequence, so a stale pick.stopOrder must
 * never reorder it back to the original office sequence.
 */
export function reconcileStopOrder(saved: string[] | undefined, stops: RunStop[]): string[] {
  const executionOrdered = stops.some((stop) => (stop as ExecutionOrderedStop).executionSequenceAuthoritative === true);
  if (executionOrdered) return stops.map((stop) => stop.orderId);
  return reconcileCoreStopOrder(saved, stops);
}
