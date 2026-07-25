# Design QA

## Evidence

- Source visual truth: `design-sources/western-deadpan-selected.png` (1487 × 1058).
- Normalized source: `audit-revision/source-1440.png` (1440 × 1024).
- Initial implementation evidence: `audit-revision/01-current-1440.png` (1440 × 1024).
- Final desktop implementation: `audit-revision/07-final-1440.png` (1440 × 1024 CSS viewport, DPR 1).
- Final mobile implementation: `audit-revision/08-final-mobile-390.png` (390 × 844 CSS viewport, DPR 1).
- Full final comparison: `audit-revision/compare-final.png`.
- Focused panel comparison: `audit-revision/compare-panel-final.png`.
- Live-route amount-dialog evidence: `audit-revision/05-live-buy-dialog.png` and `audit-revision/06-live-buy-dialog-mobile.png`.
- Compared state: pre-launch, no verified CA or canonical Gateway, no fabricated member count.

## Required fidelity surfaces

- Typography: Bebas Neue preserves the compressed editorial display voice; the final hero is a three-line block at the source's scale, with the punchline in acid green. IBM Plex Mono carries labels and status copy.
- Spacing and layout: the final desktop uses the source's dominant left hero, oversized lower-left raccoon, right poster card, separate CTA, and centered footer slogan. Desktop and mobile remain single-viewport layouts without overflow.
- Colors and tokens: paper, black, acid green, muted gray, orange focus state, hard rules, and the subtle print texture map directly to the selected direction.
- Image quality: the approved deadpan raccoon art is rendered as a real raster asset at source-like visual weight. Existing 401KEK and canonical QQQ assets are used rather than code-drawn substitutes.
- Copy and content: the selected structure is preserved while wallet-connect placeholder copy is replaced by truthful pre-launch and on-chain-member states.

## Findings and comparison history

### Iteration 1 — blocked

- P1: the initial implementation changed the selected poster into a tall transaction form. Evidence: `audit-revision/01-current-1440.png` showed a default `0.20 ETH`, smaller raccoon, non-accented technical headline, and an embedded CTA.
- P1: the arbitrary default amount implied a meaningful order before an official route existed.
- P2: `VIEW FORMULA` competed with the chain mark in the header and the right panel no longer matched the selected card-plus-CTA composition.

Fixes:

- Removed every default ETH value from the homepage.
- Restored a source-scale three-line headline, green punchline, oversized raccoon, poster-style 99/1 card, gray route-status row, and separate CTA.
- Moved the formula link into the footer.
- Kept the homepage amount-free in both pre-launch and live states. On a live route, BUY opens a focused amount dialog; the wallet is requested only after amount confirmation.

### Iteration 2 — passed

- Full comparison `audit-revision/compare-final.png` confirms the same hierarchy, crop, rhythm, palette, typography treatment, hero weight, panel placement, and CTA separation.
- Focused comparison `audit-revision/compare-panel-final.png` confirms matching row structure and proportions. The project and QQQ badges intentionally use the real project/canonical assets rather than the mock's illustrative black circles.
- Mobile `audit-revision/08-final-mobile-390.png` retains the complete hero, status, raccoon, panel, disabled CTA, and slogan in one viewport.
- No actionable P0/P1/P2 fidelity issues remain. The future raccoon micro-video is a separate optional enhancement, not a QA requirement for this still-image target.

## Interaction and runtime checks

- Pre-launch CTA is disabled and labeled `CA LOADING`; no amount input exists on the homepage.
- A simulated market-ready configuration exposed one `BUY 99/1` control and no automatic wallet request.
- BUY opened the amount dialog; blank input kept confirmation disabled.
- Entering `1.5` ETH produced `1.4850 ETH` and `0.0150 ETH` route budgets at the current zero explicit-fee configuration.
- Closing the dialog removed it cleanly.
- `VIEW FORMULA` opened `/proof`; `BACK TO BUY` returned to `/`.
- Browser diagnostics contained no errors or warnings.
- `npm run verify` passed the production build, all 4 Sites tests, and all 15 Foundry contract tests.

## Accessibility and limits

- Buttons, links, amount input, close control, dialog semantics, focus states, Escape closing, and reduced-motion fallback are implemented.
- Screenshots support visual checks but do not prove full screen-reader or real-wallet compatibility; production wallet and quote-endpoint testing still requires verified launch configuration.

final result: passed
