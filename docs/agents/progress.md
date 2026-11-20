# Progress and handover log

| Phase | Status |
| --- | --- |
| 0 Plan | done (merged to main) |
| 1 Shared core | done (waiting for commit) |
| 2 Data ZIP + zoom levels | to do |
| 3 App skeleton + dev commands | to do |
| 4 Feature parity | to do |
| 5 PWA + import | to do |
| 6 iPhone features | to do |
| 7 Liquid Glass UI + responsive | to do |
| 8 Docs | to do |
| Design | spec done (`docs/design/`) |

## Handover entries

<!-- newest at the bottom: date · phase · agent role · what was done · how to verify · open issues · questions -->

### 2026-11-20 · phase 1 · senior engineer · shared core
**Done**
- `packages/core/src/`: TypeScript port (erasable syntax, strict, no DOM/Node APIs) of `geo`, `ski`, `slope`, `piste`
  (pure-JS SHA-1 in `hash.ts` instead of `node:crypto`), `styles/`, `routing/` (SkiNetwork, options, Dijkstra, steps),
  `gpx`, `search` (index + local ranking + `entrySub` from `app.js` + browser-safe Nominatim `geocode`), `geoparse`,
  `feature-info`, `ski-areas`, `zip`, data model types in `types.ts`, everything exported from `index.ts`.
- The old planner server and the data build use the core. Old files removed (see decisions.md).
  `planner/search.mjs` now only has `resolveGoogleLink` (server only). The old frontend is unchanged.
- Tests (`npm test` = `tsc -p packages/core` + `node --test`): 49 unit tests on a small synthetic resort
  (`packages/core/test/fixtures/mini-resort.json`) + 14 golden tests on the real data.
- Golden comparison with the old code (reference copies in `packages/core/test/reference/`): 2,576 route comparisons
  ((100 seeded pairs + 20 multi-point routes + 57 lifts × 2 directions) × 11 option sets; 1,994 real routes and 582
  expected errors), each incl. GPX; network structure; search index + 317 queries; 908 info cards; ski areas; slope
  segments; pistes; labels; map styles; geoparse; ZIP bytes. All identical.

**How to verify**
- `npm test` (golden tests skip with a message when `build/planner/…json` is missing).
- `npm run build -- --only=ski` gave byte-identical styles, tile GeoJSON and planner data (except `builtAt`).
- `npm run planner`: `/api/config`, `/api/search-index`, `/api/ski-areas`, `/api/feature`, `/api/route` (4 routes,
  3 error cases) and static files returned exactly the same bytes as the old server; `/api/geocode` and `/api/resolve`
  work; a Playwright smoke test of the old UI (search) had no errors.

**Measured (real data, Node 24):** network build 45 ms cold, ~20 ms warm (old code ~17 ms warm); read + parse the
resort JSON 12 ms; search index 8 ms; ski areas 82 ms. Well under the 1 s goal of §3.2.

**Open issues / notes**
- Short runs without difficulty between 120 and 150 m do not exist in the real data, so that rule (`SHORT_UNKNOWN_RUN`)
  is only covered by a unit test, not by the golden test.
- No legacy bugs found that needed listing.

### 2026-11-20 · Design · designer
- **What:** design spec for phases 3–7: `docs/design/spec.md` (tokens, 27 components, screens with wireframes,
  interaction rules, glass performance rules, copy, icon map), `docs/design/tokens.css` (copy to
  `app/src/ui/tokens.css` as is), static mockups `docs/design/mockups/main-iphone.html` and `sheets-iphone.html`
  with PNGs (light + `-dark`) at 393 × 852 @2x.
- **Verify:** open the PNGs in `docs/design/mockups/`, or re-render with `node docs/design/mockups/render.cjs`
  (Node 24, Playwright Chromium). The script also re-inlines the icon sprite.
- **For engineers:** build components in the order of spec §2; Lucide icons via `@lucide/svelte/icons/<name>`;
  piste colours in `tokens.css` must match `packages/core/src/ski.ts` (add a test). Decisions are in
  `docs/agents/decisions.md` (designer entry).
- **Check on the real iPhone (phase 7):** blur cost while panning with a sheet open, Dynamic Type via
  `-apple-system-body` in standalone mode, search field position above the keyboard (`visualViewport`).
- **Questions for the owner:** none blocking.
