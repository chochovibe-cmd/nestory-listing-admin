# ResultCard Mobile Refinement — 2026-08-20

## Why this pass exists

Owner iPhone review confirmed containment is fixed, but the mobile hierarchy still did not match the intended workflow. This pass is presentation-only and follows the project hard rule: **do not fix A by changing unrelated C**.

## Confirmed owner requirements

### Filters
- `只看我的` and `最新在上` remain equal width.
- Height returns to the shorter control size the owner preferred (38px instead of 44px).

### Results header
- `生成結果（三站工作佇列）` and the compact `逐件審核/逐件標圖` control share one header row where space permits.
- `全選` remains available but is compact; no selection behavior is removed.

### ResultCard top row
- Product title remains the dominant text.
- Station chip (`文案待審核` etc.) and date visually follow the **last line** of the title rather than floating beside the first title line.
- Existing soft-remove `×` is moved onto the top-right card border.
- The `×` still calls the existing archive/undo flow; it is not hard delete.

### Summary
- Thumbnail stays left, enlarged/balanced for mobile (84px on narrow phone, 92px on wider mobile).
- Sale state / IP / character / type / tone / warnings stay in the right column and keep wrapping safely.
- No horizontal overflow may return.

### Price
- Sell price, compare-at strike, profit and percentage remain a single compact horizontal information row.
- No card-within-card border/background is reintroduced.

### Multi-select toolbar
- Selection count remains visible.
- `取消`, the primary batch action, and the third action occupy one compact row.
- In copy-review, the one-item `更多` menu is promoted so `移出佇列` is visible directly.
- In image-review, `更多` remains because it contains genuine extra actions (detail-image on/off + archive).
- Existing batch archive API, authorization and undo semantics remain unchanged.

### Gesture hint / swipe
- Gesture hint keeps the theme accent and is slightly more visible.
- Swipe action appearance remains compact; swipe handlers / thresholds are unchanged.

## Implementation boundary

Changed presentation file:
- `src/app/resultcard-mobile-release.css`

No changes are allowed in this pass to:
- `ResultCard.tsx` behavior;
- `DraftResultsPanel.tsx` behavior;
- long-press timing or swipe math;
- ImageUploader / upload pipeline;
- VariantEditor / variant persistence;
- review / approve / revision / archive / publish APIs;
- Supabase / RLS / migrations;
- Shopify implementation or environment;
- roles/auth.

## Runtime checklist

Before closing mobile UI work, verify on iPhone:
1. scope/sort are equal width and visibly shorter;
2. results header + sequential review look compact and do not overflow;
3. title wraps naturally; station/date sit after the title's final line;
4. card `×` sits on the top-right border and still removes with undo;
5. image/right-side tags feel balanced;
6. price/compare/profit are one row and remain inside the card;
7. long-press selected state is obvious;
8. copy-review selection shows direct `移出佇列` without the redundant one-item More layer;
9. image-review More still exposes detail-image options;
10. swipe and normal card-tap expand still work;
11. uploader remains 3-column mobile geometry.

If these pass, stop mobile ResultCard polish and proceed to final CI + Shopify release preflight.