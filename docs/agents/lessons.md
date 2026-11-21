# Lessons learned

Append-only. Every agent reads this before starting and adds an entry after any failed test, broken build or
wrong assumption. Format:

## YYYY-MM-DD · phase N · short title
- **What happened:**
- **Root cause:**
- **Prevention:** (rule to follow, and the check/test added if any)

---

## 2026-11-20 · setup · Node version
- **What happened:** the shell defaults to Node 22, while the project needs Node ≥ 24 (TileServer GL native renderer).
- **Root cause:** several Node versions are installed in the environment.
- **Prevention:** always `export PATH=/opt/node24/bin:$PATH` first (also in CLAUDE.md).

## 2026-11-20 · setup · pmtiles CLI
- **What happened:** downloading the pmtiles release from GitHub failed (GitHub API not reachable from this environment).
- **Root cause:** network policy only allows certain hosts.
- **Prevention:** install Go tools through the Go module proxy: `GOBIN=/usr/local/bin go install github.com/protomaps/go-pmtiles@latest` and link `pmtiles` to it.

## 2026-11-20 · phase 1 · golden tests that compare mostly errors prove little
- **What happened:** the first golden run picked 100 random node pairs; 1144 of 1322 comparisons were "no connection"
  errors, because the resort has many ski areas that are not linked. A mutation check (changing a constant in the
  core) then showed that some changes were not caught, e.g. the penalty for riding a lift down.
- **Root cause:** random pairs from the whole network rarely form a real route; option-specific code paths were not hit.
- **Prevention:** pick the second point from the nodes reachable from the first; add targeted cases (every lift
  bottom → top and top → bottom with every option set); assert that most comparisons are real routes. After writing a
  golden test, change one constant in the code on purpose and check that the test fails.

## 2026-11-20 · phase 1 · wrong expectations in new unit tests
- **What happened:** three new unit tests failed: a walk at the start of a leg belongs to the next leg, a 45 % slope is
  "black" not "red", and ski-area counts include closed runs.
- **Root cause:** expectations were written from memory instead of from the code's rules.
- **Prevention:** when a new test fails, first check which side is wrong by reading the rule in the code; the legacy
  behaviour is the truth. Do not change the core to fit a guessed expectation.

## 2026-11-20 · phase 1 · `git rm` stages changes
- **What happened:** deleting old files with `git rm` staged them, although the orchestrator does all commits.
- **Root cause:** `git rm` changes the index, not only the working tree.
- **Prevention:** delete files with plain `rm` (or run `git reset -q` afterwards); leave the index alone.

## 2026-11-20 · phase 1 · Playwright from Node 24
- **What happened:** `require('playwright')` failed under Node 24.
- **Root cause:** Playwright is installed globally for Node 22 only (`/opt/node22/lib/node_modules`).
- **Prevention:** run scripts that need it with `NODE_PATH=/opt/node22/lib/node_modules`.

## 2026-11-20 · phase 2 · font stacks found by walking the style are not only font names
- **What happened:** the first `build:pwa-data` run stopped with "Noto Sans Devanagari Regular v1/0-255.pbf is missing". An
  earlier version of the walker also picked up words like `get` and `min_zoom`.
- **Root cause:** the Protomaps style puts `text-font` inside expressions (`case`, `literal`, `format`), for non-Latin
  scripts. Fonts for those scripts are not downloaded by the build, and expression arrays also look like lists of strings.
- **Prevention:** `fontStacksOf` (scripts/lib/pwa-package.mjs) separates plain lists (required) from `["literal", [...]]`
  fonts in expressions (optional, skipped with a log line when not in the build). Test: "font stacks come from the styles".

## 2026-11-20 · phase 2 · scanning all `name:*` keys adds useless glyph ranges
- **What happened:** the first label scan wanted CJK glyph ranges (23552 and others) for a resort in Bavaria.
- **Root cause:** the Protomaps tiles carry translations (`name:zh`, `name:ja`, ...). The style only draws `name`,
  `name:<language>` and `name:en`.
- **Prevention:** `labelKeyTest(language)` in scripts/lib/fonts.mjs only accepts the keys the style can draw. Test: "label scan".

## 2026-11-20 · phase 2 · `z14` is not the same as the resorts.json default
- **What happened:** `build:pwa-data z14` after `z12` downloaded a new basemap (z14), not the stored z15 one.
- **Root cause:** by design `z<N>` sets basemap to min(N, 15), so `z14` means basemap 14, while the default settings are
  terrain 14 and basemap 15. Two builds can also have the same terrain zoom (same ZIP name) with a different basemap zoom.
- **Prevention:** to return to the defaults run `npm run build` without a zoom (everything is reused from `build/work/`).
  The README says what `z<N>` sets. The manifest records all three zoom levels.

## 2026-11-20 · phase 2 · tippecanoe picks the output format from the file extension
- **What happened:** (caught before it failed) the cache writes to a temporary file first; `x.pmtiles.tmp` would have made
  tippecanoe write MBTiles.
- **Root cause:** tippecanoe decides pmtiles or mbtiles from the name ending in `.pmtiles`.
- **Prevention:** temporary names end in `.tmp.pmtiles` (`useCached` in scripts/build.mjs).

## 2026-11-20 · phase 3 · test expectations written from memory (again)
- **What happened:** two new Vitest tests failed: the search result is named "1 Blue Valley" (runs carry their piste
  number), and an unfinished import folder is removed *before* the new folder name is chosen, so the name can be reused.
- **Root cause:** expectations written from what the code "probably" does, not from the fixture and the code.
- **Prevention:** before writing an expectation, look at the fixture data and the function once. The code was right in
  both cases; only the tests changed. Mutation checks were run on the import pipeline (removing the checksum
  comparison or the `.complete` marker makes 1 and 8 tests fail).

## 2026-11-20 · phase 3 · Lucide renamed icons of the design table
- **What happened:** `@lucide/svelte/icons/trash-2` and `triangle-alert` have no type declarations in Lucide 1.77: they
  are aliases of `trash` and `triangle-exclamation-point`.
- **Root cause:** Lucide renames icons between versions and keeps the old names only as untyped aliases.
- **Prevention:** all icons are imported in one place (`app/src/ui/icons.ts`) with the current names; a test imports
  every icon, and svelte-check fails on a name without types.

## 2026-11-20 · phase 3 · `setPadding` stopped the route fit
- **What happened:** the screenshots showed a new route partly behind the Route sheet, although the app calls
  `fitBounds` for routes that are hidden.
- **Root cause:** when the sheet opens, two Svelte effects run in order: the fit (starts a camera animation) and then
  `map.setPadding()`, which jumps the camera and cancels the running animation.
- **Prevention:** the padding effect is declared before the fit effect (comment in `MapView.svelte`). The smoke tests
  wait until the camera stands still (`waitForMapStill`) before the screenshots, and the screenshots are looked at
  after every UI change.

## 2026-11-20 · phase 3 · launcher left processes running; TileServer GL crash stopped everything
- **What happened:** after `dev:desktop` stopped, Vite and the desktop server kept running. TileServer GL cannot start in
  this cloud environment (`libOpenGL.so.0` is missing), and its exit stopped the whole launcher.
- **Root cause:** killing `npm run x` does not kill the node process that npm started. And every child was treated as
  required, although TileServer GL is only needed for gpx.studio links.
- **Prevention:** `scripts/lib/launch.mjs` starts each command in its own process group and kills the group; TileServer
  GL is `optional` in `start` and `dev:desktop`. Checked with `pkill -INT -f dev-desktop.mjs` → no processes left.
  The libOpenGL problem is the environment (the owner's Mac is fine), not the code.

## 2026-11-20 · phase 3 · MapLibre 6 cannot find its worker file when bundled
- **What happened:** (caught before it failed) MapLibre 6 loads `maplibre-gl-worker.mjs` relative to its own module URL;
  after bundling, that file is not next to the bundle.
- **Root cause:** the worker is a separate file in the package, not part of the bundle.
- **Prevention:** `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` + `setWorkerUrl(workerUrl)` in
  `MapView.svelte`; the smoke tests fail if the map does not render.

## 2026-11-20 · phase 3 · Playwright test files cannot use NODE_PATH
- **What happened:** (caught before it failed) the Playwright test runner loads the `.ts` test files as ES modules
  (the root package is `"type": "module"`), and ES module imports ignore `NODE_PATH`.
- **Root cause:** `NODE_PATH` only works for `require()`.
- **Prevention:** `@playwright/test` is a devDependency pinned to **1.63.0**, the version of the preinstalled browsers
  (`/opt/pw-browsers`), so no `playwright install` is needed here. `NODE_PATH` is still right for plain `.cjs` scripts.
  If the global Playwright is updated, update the pin too.

## 2026-11-20 · phase 4a · a tap test went through to the sheet (iPhone, large detent)
- **What happened:** on the iPhone projects, `undo` with `tap({ force: true })` after a settings change did nothing.
- **Root cause:** at the large detent the sheet covers the top row (design), so the forced tap landed on the sheet.
  `force` skips Playwright's "is it covered?" check and hides this kind of problem.
- **Prevention:** do not use `force: true` in the e2e tests; bring the sheet to medium first (as a user would). The
  decision that undo is not reachable at the large detent on the phone is written in decisions.md.

## 2026-11-20 · phase 4a · clip-path also clips hit testing
- **What happened:** the swipe-to-delete test touched a saved row and nothing happened.
- **Root cause:** at the medium detent the part of the sheet below the tab bar is cut off with `clip-path`; clipped
  parts get no pointer events, and the row was in that part (Playwright's bounding box still reports it).
- **Prevention:** in tests, move the sheet to large and `scrollIntoViewIfNeeded()` before touching rows that may be
  below the medium sheet.

## 2026-11-20 · phase 4a · axis labels overlapped (seen only in the screenshots)
- **What happened:** the profile chart showed "3 km3.6 km" at the end of the distance axis on the iPhone width.
- **Root cause:** ticks were dropped by distance (less than 45 % of a step before the end), not by pixels.
- **Prevention:** the chart drops ticks closer than 44 px to the end label. Look at every screenshot after a UI
  change; the unit test for `distanceTicks` also had a wrong expectation written from memory (again) — compute
  expectations from the function's rule first.

## 2026-11-20 · phase 4a · MapLibre marker classes (caught before it failed)
- **What happened:** updating the route markers in place with `el.className = …` would remove MapLibre's own
  `maplibregl-marker` classes, and the markers would lose their positioning.
- **Prevention:** only use `classList.toggle` on elements handed to MapLibre (comment in `MapView.svelte`).

## 2026-11-20 · phase 4a · cutting old functions out of app.js
- **What happened:** the first version of the parity test failed with a syntax error.
- **Root cause:** `const fmtTime = (s) => {` spans several lines; the extractor ended at the first `;`.
- **Prevention:** the extractor treats a first line ending in `{` or `[` as a block that ends at a line starting with
  `}` / `]`. A mutation check (changing the slice length and the 30 m window) made the parity test fail as expected.

## 2026-11-21 · phase 4b · a no-op `setPadding` stopped the 3D tilt
- **What happened:** the iPhone e2e test sometimes saw the map stay flat after switching 3D on (pitch never > 30).
- **Root cause:** the sheet reports its position again after it settles (320 ms), the padding object is new but has the
  same values, and `map.setPadding()` jumps the camera, which cancels the running `easeTo({ pitch: 60 })`. Same family
  as the phase 3 lesson, but with equal values.
  A second cause showed up in the next run: right after a large → medium change, `ui.sheetTop` still held the *large*
  top until the sheet settled, so the padding really changed twice.
- **Prevention:** `MapView` only calls `setPadding` when a value really changed, and the app computes the medium
  padding from `round(0.475 × H)` (the sheet's own rule), not from `ui.sheetTop` (comments in both). The explore test
  switches 3D right after moving the sheet and checks the pitch. Any new camera animation must survive a sheet settle.

## 2026-11-21 · phase 4b · expectations written from memory (third time)
- **What happened:** two new tests failed: a lift card expected a "Direction" row (the test fixture's lifts have no
  `direction`; only built data has it), and the search pin title expected "See-Eckbahn" (search names carry the lift
  number, "23 See-Eckbahn" – already in the phase 3 lesson).
- **Root cause:** the expectation was written from the old UI on real data, not from the fixture and the code.
- **Prevention:** print the fixture's properties (`python3 -c …` / `node -e …`) before writing an expectation on it;
  for names from the search index use `toContainText`. Code was right both times; only the tests changed.

## 2026-11-21 · phase 4b · Playwright: stale map queries and stale result rows
- **What happened:** `queryRenderedFeatures` right after hiding a layer still returned 18 lifts; `toHaveText` on the
  search rows failed with "strict mode violation: 11 elements" right after typing a new query.
- **Root cause:** rendered features update with the next frame; the rows of the previous query stay until the
  150 ms search debounce has run.
- **Prevention:** wrap map queries in `expect.poll`; for lists, first `toHaveCount(n)` (retries), then check the text.

## 2026-11-21 · phase 4b · the top row is under the large sheet (again)
- **What happened:** an iPhone test tried to tap the menu button while the Map sheet was at the large detent and timed
  out after 3 minutes ("sheet-head intercepts pointer events").
- **Root cause:** by design the large sheet covers the top row (phase 4a lesson); the new test forgot it.
- **Prevention:** in e2e tests, every tap on a top-row control on the phone follows a check that the sheet is at
  medium (`sheet-handle` tap + `data-detent` = medium). Do not use `force`.

## 2026-11-21 · phase 4b · fixing the padding bug changed test timing
- **What happened:** after the `setPadding` fix the iPhone route test failed: point C was never added, and 3D was on.
- **Root cause:** after A and B the new route is fitted into the free part of the map. Before, the needless
  `setPadding` cut that animation short; now it runs to the end, and C was projected while the camera was moving, so
  the tap landed on the 3D button.
- **Prevention:** e2e helpers that tap map coordinates frame the points again and wait for `waitForMapStill` before
  *every* tap (`tapPoints` in route.spec.ts). Never project once and tap later while a route can appear.

## 2026-11-21 · phase 5 · waiting for a log line that was already printed
- **What happened:** the new offline e2e test cleared the collected console lines and then waited for the
  "[routing]" line. It timed out on both PWA projects.
- **Root cause:** after the offline reload the routing worker was ready before the test reached that line; the line
  was printed and then thrown away by the clear.
- **Prevention:** wait for a state, not for an event that may be over: poll `window.__app.routingReady` (the `?e2e`
  hook). Only clear a log *before* the action that writes the line.

## 2026-11-21 · phase 5 · `TARGET` from a module is not a build-time constant for Rollup
- **What happened:** (caught before it failed) the first desktop build still had the service worker chunk
  (`register-*.js`), although the import sat behind `if (TARGET === 'pwa')`.
- **Root cause:** `TARGET` is a constant exported from `platform/index.ts`; Rollup does not fold it across modules
  for a dynamic import, so the chunk was emitted (never loaded, but shipped).
- **Prevention:** code that must not be in one build is guarded by the literal `import.meta.env.VITE_TARGET` (or
  `import.meta.env.DEV`). `scripts/e2e.mjs` now fails when `app/dist-desktop` has Workbox code, `sw.js` or a manifest.

## 2026-11-21 · phase 5 · a changed rule needs its old tests changed on purpose
- **What happened:** two existing tests failed after the phase 5 changes: the "disk full" import test expected the
  old message, and the desktop short-link search test had online mode off.
- **Root cause:** both were intended changes (a clear "Not enough space" message; short links now need online mode
  and a network, plan §6). Not a code bug.
- **Prevention:** when a rule changes on purpose, update the old test in the same change and say so in
  decisions.md, so the next agent does not "fix" the code back.

## 2026-11-21 · phase 6 · expectation from memory (fourth time)
- **What happened:** a new core test expected the far point to be 3 km farther than the near one; it is 2.9 km.
- **Root cause:** the distances were estimated in the head, not computed.
- **Prevention:** print the real value once (`node -e` / a scratch script) before writing a number into a test; then
  assert a narrow range around it with a comment that says where it comes from.

## 2026-11-21 · phase 6 · a camera move on a mode change stopped the turn to north
- **What happened:** the e2e test tapped the compass in "follow with heading"; the map stayed at a 10° bearing.
- **Root cause:** the compass tap changed the Locate mode to "follow" and started `easeTo({ bearing: 0 })`. The
  follow effect re-ran because the mode changed and called `easeTo({ center })`, which cancels the running rotation.
  Same family as the phase 3/4b `setPadding` lessons: any camera call stops a running animation.
- **Prevention:** the follow effect only moves the camera for a new fix, a new heading or an explicit centre request,
  never for a mode change alone; and while a "turn north" runs, follow moves keep `bearing: 0`. The e2e test checks
  the bearing after the compass tap.

## 2026-11-21 · phase 7 · the medium sheet had no blur in Chromium
- **What happened:** the new glass budget check in `design.spec.ts` found that the sheet's glass layer had
  `backdrop-filter: none` in Chromium. The sheet looked fine in screenshots because its fill is 78 % opaque.
- **Root cause:** the sheet CSS had `backdrop-filter` first and `-webkit-backdrop-filter` second. The CSS minifier
  treats them as the same property and keeps only the last one; Chromium ignores the prefixed one. Safari would have
  worked, so this was hidden until a test measured it.
- **Prevention:** always write `-webkit-backdrop-filter` first and `backdrop-filter` right after it.
  `app/test/css-lint.test.ts` checks every `.svelte`/`.css` file for this (mutation-checked: swapping the two lines
  fails it). The e2e glass budget counts the blurred surfaces, so a lost blur shows up as a lower count.

## 2026-11-21 · phase 7 · iOS system colours are not WCAG AA
- **What happened:** the first axe run failed on 198 places: secondary text, blue buttons, red Clear, the "Ctrl K"
  hint.
- **Root cause:** the design tokens copied iOS values; iOS system blue on white is 4.0:1 and the 60 % secondary label
  3.4:1, below 4.5:1.
- **Prevention:** colours are checked twice: `app/test/contrast.test.ts` (token maths, glass over snow and the
  darkest map) and axe on every main screen in light and dark (`design.spec.ts`). Change a text colour only with
  both green. Text on glass uses `--glass-label`, `--glass-label-2` or `--glass-accent`, never `--label-3`.

## 2026-11-21 · phase 7 · `height` with padding on a capsule
- **What happened:** the tab capsule was 72 px high instead of 64 (seen while measuring the glass budget).
- **Root cause:** there is no global `box-sizing: border-box`; `height: 64px` plus `padding: 4px` made 72.
- **Prevention:** components that set both `height` and vertical `padding` also set `box-sizing: border-box`. The
  design spec measures the glass surfaces, so such errors show in the `[glass]` log lines.

## 2026-11-21 · phase 7 · Undo tap missed the toast under load (flaky e2e)
- **What happened:** in 2 of 4 full e2e runs (two workers) the iPhone route test tapped Undo in the "Route deleted"
  toast and the route did not come back. Repeating the test with 3 workers failed 1–2 times in 6.
- **Root cause:** debug logs showed the toast's button was never clicked. The tap came while the toast was still
  sliding in (250 ms entry animation); with slow frames (busy CPU, and now a real blur on the sheet) Playwright saw
  the toast as "stable" between two slow frames and the touch landed off the button. A person taps a toast that has
  settled, so this was a test problem.
  While looking, a real app bug showed up: after a full swipe the red Delete button lies under the finger, and the
  click that can follow the touch could call delete a second time.
- **Prevention:** the test waits for `el.getAnimations()` of the toast to finish before tapping (9 of 9 green under 3
  workers afterwards). Rule: before tapping something that animates in, wait for its animations. The app now deletes
  once (`SwipeRow` guard + `SavedState.delete` ignores a second delete of the same route); unit test "a second delete
  of the same route while the first runs is ignored" (fails without the guard). Failure screenshots are now kept
  (`screenshot: 'only-on-failure'` in the Playwright config).

## 2026-11-21 · after phase 8 · a manual test ZIP broke the real-data test
- **What happened:** `app/test/real-data.test.ts` (which always picks the newest `.zip` in `build/pwa/`) failed on
  `engine.search('Nebelhorn')` returning 0 results.
- **Root cause:** a previous manual test of the new "Build region" page had built a small region ZIP
  (`test-ifen-box-…zip`) straight into `build/pwa/` and never cleaned it up. It was newer than the real Oberstdorf
  ZIP, so the test picked it up instead; that small test box has no Nebelhorn ski area.
- **Prevention:** every region build's ZIP lands in `build/pwa/` by design (`server/region-builds.mjs`), the same
  folder as the main build's ZIP, so the page can list/download it and the dev "Load data from build/" button can
  find it too. After trying a region build by hand, delete its ZIP (and `build/regions/<id>/`) when done. Before
  trusting `real-data.test.ts`'s failure as a code bug, check `ls -la build/pwa/` for anything that isn't the
  expected build's ZIP — the test always picks the newest one.
