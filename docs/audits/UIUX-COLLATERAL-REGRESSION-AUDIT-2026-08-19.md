# UIUX Collateral Regression Audit — 2026-08-19

## Audit question

Find cases where an optimization intended for **A** also changed **B**. Repair only proven B collateral; preserve A and later useful UX. Historical “程式核帳通過” is not treated as owner visual acceptance because many handoffs explicitly still said “畫面待老闆”.

## Method

For each high-risk UIUX commit, compare:

1. recorded work brief / intended A;
2. commit message;
3. actual diff;
4. current source residue;
5. present symptom or interaction with later CSS.

A commit is not reverted merely because its history is messy or its title is incomplete. If evidence is insufficient, code stays unchanged.

## Findings matrix

| Surface | Commit(s) | Intended A | B / risk found | Verdict | Action |
|---|---|---|---|---|---|
| ImageUploader geometry | `4304866`, `ed342ce`, `159721e`, `8c7db19` | P10 spec/Station② UX; later P09 complete look | nowrap + 96/120 makes input uploader oversized; P08 itself records the input-layout regression | owner now explicitly supersedes that geometry | restore wrap + 64/96 only |
| ImageUploader spec/delete controls | `ed342ce`, `2cc900b`, `8c7db19` | spec corner + free corner for delete × | placement changed from old below/right to top-right/left | recorded deliberate P10/P09 A; no present proof of breakage | **KEEP**; runtime-check only |
| ImageUploader functional UX | `e2d797`, `b130aa`, A19, AF batches | paste, retry, reorder, fade, spinner, dual-size | no collateral found in target geometry | useful later UX | **KEEP** |
| ResultCard mobile | `47a96c` | explicit 3-row title / thumb+chips / regen+price | 64px thumb track reused by ≥72px regen; nowrap price + P07 clip exposes overflow | high-confidence implementation collateral inside A | nested row3 grid; keep P04 3 rows |
| ResultCard gestures | `ba7d69d`, P0-3, P1-1 | long-press/swipe/multi-select + expand safety | historical interactive-target conflict | already separately stabilized | **KEEP** |
| Workbench containment | `5f73952` | stop desktop left/right column overlap | can clip children that intentionally paint outside | containment itself is intentional | **KEEP** |
| Variant picker | `e798b5a` + P07 | 72px picker + desktop hover/mobile zoom | outer-column hover preview collided with P07 clipping | already repaired by P1-2 without reverting either feature | **KEEP** |
| Variant P01/P03 shared tree | `2b5d3f7`, `6af3a25` | tags + variant P03 work | commit title/tree mixed | docs explicitly acknowledge P03 CSS in shared tree; no current bug proof | **NO CHANGE** |
| B2/B3 result chrome | `a2fe3b8`, `862c175`, `ac8b25e`, others | station/filter/scope/chrome UX | no current target-surface collateral proven | scoped changes match recorded intent | **KEEP** |
| UX-PKG / AF polish | PKG1–6, AF16–19 | nav/panel/polish/a11y/animations | broad CSS footprint | audited; no high-confidence current collateral in target surfaces | **KEEP** |

## High-confidence repair set

Only two code effects passed the evidence threshold:

### 1. ImageUploader geometry

Canonical pre-regression geometry is B17 `4304866`:

- secondary 64×64;
- main 96×96;
- wrapped strip.

The repair changes only these layout properties. It does not move the current spec badge or delete control and does not alter uploader behavior.

### 2. ResultCard row-3 track coupling

P04 is retained as the intended three-row mobile design. The accidental implementation coupling is:

- row 2 needs a fixed 64px thumbnail track;
- row 3 reused it for a regenerate action whose minimum width is 72px.

The repair makes row 3 span the parent width and gives it an independent `max-content minmax(0, 1fr)` grid. Regen remains left; price remains right.

## Explicit no-change decisions

Do not, based on this audit alone:

- move the input spec badge;
- move the input delete ×;
- revert P04 to the old B2-P09 ResultCard;
- split P04 regen and price into separate visual rows;
- remove gesture hint / long-press / swipe / multi-select;
- relax P07 workbench containment;
- revert Variant B-layout / zoom / row reorder;
- rewrite mixed P01/P03 history merely to make commits look cleaner;
- revert PKG/AF polish without runtime evidence.

## Additional history notes

### P08 was not a 1:1 restoration

P08 `159721e` records the pre-P10 anchor as 64/96, but implemented 72/96. This supports the owner’s recollection that a prior “repair” was not exactly the original geometry.

### P09 intentionally restored P10

P09 `8c7db19` explicitly restored nowrap 96/120 plus the P10 control placement. Therefore the current oversized uploader is not treated as a mysterious CSS accident; it is an old deliberate design choice that the owner has now explicitly superseded for geometry only.

### “核帳通過” was often source-level only

The historical UIUX sync documents repeatedly pair “程式核帳通過” with “畫面待老闆”. Those labels prove a source review happened; they do not prove the owner visually accepted the mobile result.

## Runtime gate

History/source inspection can prove intent and contradictory geometry, but final visual truth still needs one mobile Preview after Vercel Hobby deployment quota recovers. The single preview should verify:

- ImageUploader wraps at 64/96 without horizontal overflow;
- current spec badge and delete × remain readable and tappable;
- upload spinner, retry, drag/reorder and soft-remove still work;
- ResultCard still visibly follows title / thumb+chips / regen+price;
- row3 regen-left / price-right no longer clips;
- explicit expand, long-press and swipe remain;
- Variant picker/zoom remains contained.

Any new visual concern that is not proven by source or reproduced in that Preview stays out of code until it is confirmed.
