// #338 customer C1-C4 staging is complete and closed.
// Keep this tombstone instead of an executable mutation client so stale imports or
// manual reuse cannot replay the consumed customer continuation chain.

export async function runAuthorizedCustomerC4(): Promise<never> {
  throw new Error('UNLEASHED_CUSTOMER_STAGING_CLOSED');
}
