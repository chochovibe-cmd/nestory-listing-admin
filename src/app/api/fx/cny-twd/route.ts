import { fetchCnyTwdRate } from "@/lib/fx/fetchCnyTwdRate";

/**
 * C6: public (authenticated session not required) read of live CNY→TWD.
 * Used by settings "抓取今日匯率" and header auto-refresh of 今日參考.
 * Never mutates applied pricing — client decides what to store where.
 */
export async function GET() {
  const result = await fetchCnyTwdRate();

  if (!result.ok) {
    return Response.json(
      {
        ok: false as const,
        error: result.error,
        message: "無法取得今日匯率，請稍後再試（不影響已套用中的匯率）。"
      },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true as const,
    rate: result.rate,
    asOf: result.asOf,
    source: result.source
  });
}
