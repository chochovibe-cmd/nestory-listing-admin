# Next Optimization Plan

Purpose: help ChochoNest staff quickly create Shopify-ready listings with minimal manual input, AI-generated copy, review control, and reliable Matrixify batch import.

## Implemented In Current Local Build

- Product source selector: 淘寶, 閑魚, 蝦皮. Default is 淘寶.
- Cost currency selector: CNY default, optional TWD. TWD costs skip CNY exchange rate.
- Compare At Price input for Shopify strikethrough pricing.
- Variants: option name, SKU, price override, inventory quantity.
- Result cards collapse after generation and show quick scan fields: generated title, sell price, profit.
- Original source title is preserved inside the expanded detail view.
- Review workflow: generated items start as pending review; batch CSV exports reviewed items only.
- Rerun workflow: send an item back to the queue with an operator note.

## Deferred

- Taobao URL ingestion: paste a Taobao product link and auto-fetch title, images, variants, and specs. This should be handled after the current manual-input workflow is stable.

## Recommended Next Priorities

- Add a staff-friendly import checklist before CSV download.
- Add bulk approve controls after previewing several generated listings.
- Add saved listing templates for common product types.
- Add source-specific defaults, especially Taobao versus Taiwan-source pricing.
