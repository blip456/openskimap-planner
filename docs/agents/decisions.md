# Technical decisions and deviations from the plan

<!-- date · phase · decision · why · who advised (senior engineer / tester / designer) -->

## 2026-11-20 · phase 1 · shared core layout and tooling (senior engineer)
- **One npm package at the root, no workspaces.** Code imports the core by relative path with the `.ts` extension
  (`../packages/core/src/routing/index.ts`). `packages/core/package.json` only sets `"type": "module"` and a name; it
  is not installed as a dependency. Why: simplest imports for Node, the old planner and (later) Vite; no symlinks.
- **Erasable TypeScript only**, run directly by Node 24 (type stripping). `packages/core/tsconfig.json`: `strict`,
  `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. `lib: ["ES2023", "WebWorker"]`
  and `types: []`: the type check fails if core code uses DOM-only (`document`, `window`) or Node APIs. `npm run typecheck`.
- **Tests are plain `.mjs` files** run with `node --test` (`npm run test:core`); they import the `.ts` sources. Not
  type-checked, so they can import the legacy JavaScript reference copies freely. `npm test` = typecheck + core tests;
  later phases add their app tests to the `test` script.
- **Golden tests** compare the core with reference copies of the old code in `packages/core/test/reference/` (taken
  before the switch). They skip with a message when `build/planner/oberstdorf-kleinwalsertal.json` is missing
  (`PLANNER_DATA` can point to another file).
- **Module split:** `geo`, `ski` (classes + colours), `slope`, `piste`, `hash`, `routing/` (`graph`, `options`,
  `steps`, `heap`), `gpx`, `search` (index, local ranking from `app.js`, Nominatim `geocode`), `geoparse`,
  `feature-info`, `ski-areas`, `zip`, `styles/`, `types`, and `index.ts` exporting everything.
- **piste ids without `node:crypto`:** a small pure-JS SHA-1 (`hash.ts`) gives the same ids (tested against
  `node:crypto` and against the ids in the built data). Keeps `assignPistes` usable in the browser.
- **`geocode` in the core sends no custom User-Agent.** It takes `{ headers, fetch }` options; the desktop server passes
  its User-Agent (`NOMINATIM_HEADERS` in `planner/search.mjs`) to follow the Nominatim policy.
- **`resolveGoogleLink` stays in `planner/search.mjs`** (server only). It moves to `server/` in phase 3.
- **Old frontend keeps its own copies** of `planner/public/geoparse.js` and `zip.js` (served as plain browser modules,
  no build step). The golden test checks that the core gives the same results as these files' reference copies.
  The copies go away with `planner/` in phase 4.
- **Removed** `planner/graph.mjs`, `planner/feature-info.mjs`, `planner/ski-areas.mjs` and `scripts/lib/{geo,ski,piste,slope,styles}.mjs`;
  `planner/server.mjs` and `scripts/build.mjs` import the core. `scripts/lib/pmtiles-file.mjs` stays (Node only).
- `makeZip(files, now?)` got an optional date argument for tests; the default is unchanged.

## 2026-11-20 · phases 3–7 · design spec (designer)
Full spec: `docs/design/spec.md`, tokens: `docs/design/tokens.css`, mockups: `docs/design/mockups/`.
- **Accent = iOS system blue** (`#007AFF` / `#0A84FF`), the only tint colour. Run colours never style UI chrome.
  Why: matches the native test app and iOS; the piste blue stays a map colour.
- **Medium sheet floats 8 px above the tab bar** (strong glass, inset 8); **large sheet is solid** and edge to edge,
  and the tab bar floats over it with a mask fade. Why: plan §8.3 keeps the tab bar visible; a solid large sheet
  saves the biggest blur.
- **Undo + redo in one capsule, hidden when there is nothing to undo/redo**; compass in its own button under the 3D
  capsule; the mode pill is centred in the width left of the compass column. Why: fixes the overlap, cut-off compass
  and invisible disabled undo seen in the native app (plan §8.2).
- **Plan + Locate row 24 px above the tab bar**, the map credit line sits in that gap; MapLibre attribution control off,
  full credits in Menu › About. At medium detent the two buttons ride on the sheet edge.
- **Glass budget as area + count** (≤ 30 % of the viewport, ≤ 6 surfaces normally, ≤ 9 peak) instead of plan §8.5's
  "3–5 surfaces". Why: the plan's layout already has 6 small glass controls; cost is mostly blurred area. Moving
  fallback (`data-map-moving`) only if profiling on the iPhone shows dropped frames.
- **Chart readout replaces the chart header while scrubbing** (no floating bubble). Why: a bubble covered the
  segmented control and could leave the cell on narrow screens.
- **iPhone: tapping a route marker opens it in the Route sheet** instead of removing it (desktop keeps
  click-to-remove). Why: accidental removals with fingers; removing is one tap in the list. Drag lifts the marker
  26 px above the finger.
- **Search results never add a point directly**: they open the info card with the "Use this spot" actions, as the
  current web planner does (the native app added the point at once).
- **Landscape phone uses the desktop arrangement** (left panel with segmented tabs), no bottom bar.
- **Dynamic Type** through `html { font: -apple-system-body }` on touch Safari + rem for sheet content; map chrome
  stays px. Desktop root 15 px.
- **Map style stays light in dark mode**; only the UI follows the system theme.
- **Icons: Lucide** (`@lucide/svelte`, per-icon imports) + 3 custom SVGs (location-heading, compass needle, logo).
