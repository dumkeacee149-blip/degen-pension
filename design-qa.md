# Design QA

## Evidence

- Selected visual source: `design-sources/western-deadpan-selected.png` (1487 × 1058).
- Desktop implementation: `qa/home-1440-final-v2.png` (1440 × 1024 viewport and document).
- Normalized source: `qa/source-1440.png` (1440 × 1024).
- Full side-by-side: `qa/comparison-1440.png`.
- Focused buy-panel comparison: `qa/comparison-panel.png`.
- Mobile implementation: `qa/home-mobile-390-v6.png` (390 × 844 viewport and document).
- Formula page: `qa/proof-1440-viewport-v2.png`; route `/proof`.
- Validated state: pre-launch, with no verified CA/Gateway configured and no fabricated member count.

## Fidelity review

- Preserved the selected direction's deadpan Western trash-panda character, paper grain, black/acid-green palette, condensed display type, hard rules, and editorial two-column composition.
- Adapted the selected mock into a functional one-screen buy surface: input amount, fee-first net 99/1 route budgets, pre-launch lock state, live member status, and a direct link to the proof page.
- Replaced the mock's automatic wallet prompt with the approved behavior: the page makes no wallet request on load; a wallet request can occur only after an enabled BUY action.
- `PENSION MEMBERS` is explicitly defined as unique recipients in the canonical Gateway's successful `SplitBuy` events where `stockAmountOut > 0`.
- Global holder state changes the headline and raccoon art across pre-launch, loading/error, zero, growing, and crowded stages.

## Responsive and interaction checks

- Desktop 1440 × 1024: one viewport, no horizontal or vertical page overflow.
- Mobile 390 × 844: one viewport, all core content and the disabled CTA remain visible; no horizontal overflow.
- Amount input test: `1.5` ETH produced `1.4850` and `0.0150` route budgets at the current zero explicit-fee configuration, then was restored to `0.20`.
- Pre-launch CTA is disabled and labeled `CA LOADING`.
- `VIEW FORMULA` opens `/proof`; `BACK TO BUY` returns to `/`.
- `/proof` exposes the fee-first formulas, the on-chain member-count definition, and the corresponding calculation/settlement Solidity excerpts.
- Browser diagnostics contained no error or warning entries; only Vite development messages and the React DevTools informational notice were present.
- Production build, Sites packaging tests, and all 15 Foundry contract tests passed.

## Comparison history

- Early desktop pass allowed the buy panel to collide with the footer at short heights; the panel height and low-height grid were constrained.
- Early mobile passes hid the raccoon, pushed the CTA below the fold, and inherited a two-column layout; mobile now uses an explicit single-column, one-screen grid.
- Final desktop pass increased the raccoon presence and panel height and broke the headline into a stronger three-line editorial block to better match the selected source.

## Intentional differences

- Copy reflects verified runtime state rather than the selected mock's placeholder wallet-connect state.
- The live BUY action remains locked until the official CA, canonical Gateway, activation block, quote endpoint, and canonical QQQ route are configured.
- The extra `VIEW FORMULA` affordance exists because the operating logic must live on a separate public page.

final result: passed
