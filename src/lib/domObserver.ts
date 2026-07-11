/**
 * Shared body-mutation scheduler.
 *
 * The enhancer layer used to attach ~27 independent MutationObservers to
 * document.body (subtree, attributes, characterData). Every DOM change fanned
 * out to every callback, several of which mutate the DOM themselves, so one
 * change triggered cascading observer storms - the main jank source on
 * low-end warehouse/driver phones.
 *
 * This module keeps exactly one observer and one trailing 150ms flush. All
 * enhancer callbacks register here; they must stay idempotent (they already
 * are - render-key guards / "create if missing" patterns).
 */

type Callback = () => void;

const FLUSH_DELAY_MS = 150;
const callbacks = new Set<Callback>();
let observer: MutationObserver | null = null;
let flushTimer: number | null = null;

function flush() {
  flushTimer = null;
  callbacks.forEach((callback) => {
    try {
      callback();
    } catch {
      // One broken enhancer must not stop the others.
    }
  });
}

function schedule() {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

/**
 * Registers a callback for batched body mutations. Runs the callback once
 * immediately. Returns an unsubscribe function for useEffect cleanup.
 */
export function observeBody(callback: Callback): () => void {
  callbacks.add(callback);
  try {
    callback();
  } catch {
    // Initial run failures are the callback's own concern.
  }
  if (!observer) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'style', 'hidden'],
    });
  }
  return () => {
    callbacks.delete(callback);
    if (!callbacks.size && observer) {
      observer.disconnect();
      observer = null;
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
    }
  };
}
