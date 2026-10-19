/**
 * SHOP-LISTING: run async work over a list with at most `limit` tasks in flight.
 * Client-safe (no imports).
 *
 * - Result array order === input order.
 * - Failure policy: a rejected `fn` call does NOT stop the other items and does NOT
 *   reject the whole run; its slot in the result is `{ status: "rejected", reason }`
 *   (settled form, like Promise.allSettled).
 */
export type ConcurrencyResult<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown };

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<ConcurrencyResult<R>[]> {
  const results: ConcurrencyResult<R>[] = new Array(items.length);
  const workerCount = items.length === 0 ? 0 : Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
