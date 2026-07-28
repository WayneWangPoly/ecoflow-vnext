export type TrustedLiveSnapshot<T> = {
  data: T;
  acceptedSequence: number;
};

export type TrustedLiveResolution<T> = {
  snapshot: TrustedLiveSnapshot<T> | null;
  source: 'fresh' | 'last-trusted' | 'unavailable';
};

/**
 * Selects only server-derived data. A missing candidate may retain the last
 * accepted live snapshot, but this boundary never manufactures sample facts.
 */
export function resolveTrustedLiveSnapshot<T>(
  current: TrustedLiveSnapshot<T> | null,
  candidate: T | null | undefined,
  sequence: number,
): TrustedLiveResolution<T> {
  if (candidate !== null && candidate !== undefined) {
    return {
      snapshot: { data: candidate, acceptedSequence: sequence },
      source: 'fresh',
    };
  }
  if (current) return { snapshot: current, source: 'last-trusted' };
  return { snapshot: null, source: 'unavailable' };
}
