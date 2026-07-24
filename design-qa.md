# Design QA — DEGEN PENSION

final result: passed

## Visual source and target

- Selected source: `/Users/a7/Documents/Codex/2026-07-24/ni/.design-options/midnight-office.png`
- Source dimensions: 1440×1024
- Primary implementation viewport: 1440×1024 browser override; rendered page client width 1425px after scrollbar allocation
- Final desktop capture: `.design-qa/final-desktop.png`
- Final mobile capture: `.design-qa/final-mobile.png`
- Side-by-side comparisons: `.design-qa/compare-v1.png` and `.design-qa/compare-v2.png`

The source and implementation were placed together in one 2850×1013 comparison image. The second pass reduced excess hero top space, brought the full primary CTA into the first viewport, shifted the character crop to retain 1仔, and replaced the placeholder Q chip with Robinhood's official QQQ token logo.

## Visible comparison

### Matched

- Black / old-ledger cream / acid green / rust palette
- Oversized condensed headline and mono terminal labels
- Left split-buy panel with one dominant 99/1 bar
- Editorial ink-and-halftone raccoon office art
- Hard borders, ledger rules and restrained square geometry
- Trust strip immediately below the primary product surface

### Intentional differences

- The prototype adds explicit `MVP TESTED`, `AWAITING OFFICIAL CA` and `PRE-LAUNCH DEMO` states so the page cannot be mistaken for a live market.
- Fake portfolio and activity routes from the visual concept were omitted because they are not part of the core task.
- The product panel shows route budgets rather than fabricated output-token quantities.

## Interaction QA

- Amount input changed from `0.20` to `1.5`; UI produced exactly `1.4850 ETH` and `0.0150 ETH` route budgets.
- `REVIEW 99/1 SPLIT` opened a readable review dialog with fee-first semantics, both atomic legs and a clear no-live-market warning.
- Close action and Escape handling are wired.
- Wallet connection checks for an injected provider; without one, the page shows an honest fallback and does not fabricate a connection.
- Mobile navigation opens and exposes all four primary section links.
- Canonical QQQ address has a copy action.

## Responsive and accessibility QA

- Desktop: 1425px document width / 1425px client width; no horizontal overflow.
- Mobile: 375px document width / 375px client width at a 390×844 browser viewport; no horizontal overflow.
- No unnamed buttons, links or inputs were found.
- No images were missing `alt` attributes.
- Focus-visible styling and reduced-motion handling are present.

## Runtime QA

- Browser console: 0 warnings, 0 errors.
- `npm run build`: passed.
- Sites worker tests: 4/4 passed.
- Foundry tests: 15/15 passed.
- No mainnet deployment, live quote or transaction hash is represented in the UI.
