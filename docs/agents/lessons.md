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
