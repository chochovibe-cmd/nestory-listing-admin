export type PageResult<T, E> = {
  data: T[] | null;
  error: E | null;
};

/** Fetch every row from a stable, ordered Supabase query using inclusive ranges. */
export async function fetchAllRows<T, E = unknown>(
  queryPage: (from: number, to: number) => PromiseLike<PageResult<T, E>>
): Promise<PageResult<T, E>> {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await queryPage(from, to);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
