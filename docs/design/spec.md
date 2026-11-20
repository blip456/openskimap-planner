# Design spec: ski route planner (iPhone PWA + desktop)

Status: **ready for phases 3–7**. Owner of this document: design. Follows `docs/pwa-plan.md` §7–§9; where this spec
adds detail or deviates, it says so and the reason is in `docs/agents/decisions.md`.

**Files**

| File | What |
| --- | --- |
| `docs/design/tokens.css` | All design tokens. **Copy it to `app/src/ui/tokens.css` as is.** It is the source of truth for every value in §1. |
| `docs/design/mockups/main-iphone.html` | Main map screen (plan mode, route, location, compass) + search with keyboard. |
| `docs/design/mockups/sheets-iphone.html` | Route sheet (medium + large), Map sheet, Menu, Menu › Data with import progress, first-run screen. |
| `docs/design/mockups/*.png` | The mockups rendered at 393 × 852 @2x, light and `-dark`. Re-render: `node docs/design/mockups/render.cjs`. |
| `docs/design/mockups/mockup.css` | Mockup CSS. Not production code, but class names follow §2 and can be used as a starting point. |

Units: **1 CSS px = 1 iOS pt.** All sizes below are in px.

**Five rules to remember**
1. The map is the content. **Glass only on the navigation layer** (bars, map buttons, sheets at medium, search). Never glass on glass, never glass inside a sheet (cells, charts, cards are solid).
2. **Concentric shapes:** a capsule's radius is half its height; an inner shape's radius = outer radius − padding.
3. **Touch target ≥ 44 × 44** everywhere, even when the visible shape is smaller.
4. **Tint only the main action** (Plan route when on, the primary button of an empty state, the selected tab). Run colours are never used for UI chrome.
5. **Animate only `transform` and `opacity`.** Never animate `backdrop-filter`, `width`, `height`, `top`.

---

## 1. Design tokens

The full set is in `docs/design/tokens.css` (≈ 300 lines, light, dark, increased contrast, solid interface, reduced
motion and the base `html`/`body`/`.glass` rules). This section explains how to use them.

### 1.1 Colours

iOS 26 system colours. Light / dark values are switched by `prefers-color-scheme`; the app has no own theme switch.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--accent` | `#007AFF` | `#0A84FF` | The one tint colour: selected tab, links, checkmarks, Plan route on, primary buttons, focus ring |
| `--green` | `#34C759` | `#30D158` | Switch "on" track |
| `--red` | `#FF3B30` | `#FF453A` | Destructive rows and buttons (Clear, Delete) |
| `--orange` | `#FF9500` | `#FF9F0A` | Route warnings, "Changed since you saved it", "no network" badge |
| `--label` / `-2` / `-3` / `-4` | `#000` / 60 % / 30 % / 18 % | `#FFF` / 60 % / 30 % / 16 % | Text: primary, secondary (subtitles, values), tertiary (chevrons, placeholders) |
| `--separator` | `rgba(60,60,67,.29)` | `rgba(84,84,88,.6)` | 0.5 px hairlines in groups |
| `--fill-1…4` | iOS system fills | | Switch-off track, segmented track, round buttons in sheets, row hover |
| `--bg-grouped` | `#F2F2F7` | `#1C1C1E` | Sheet background (large) and menu pages |
| `--bg-cell` | `#FFFFFF` | `#2C2C2E` | Inset group cells (dark values match the owner's screenshot of the native app) |
| `--toast-bg` | `rgba(28,28,30,.92)` | `rgba(242,242,247,.94)` | Toasts (inverted, solid) |

**Map colours never change with the theme.** The map style stays light in dark mode (there is no dark map style in
scope). Copied from `packages/core/src/ski.ts` (`RUN_COLORS`, `LIFT_COLOR`, `NORDIC_COLOR`, `CONNECTION_COLOR`), `packages/core/src/slope.ts` and today's `planner/public/app.js` (markers, route layers; these were in `scripts/lib/styles.mjs` before phase 1):

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--piste-novice` | `#2e9d3a` | | `--lift` | `#7b1fa2` |
| `--piste-easy` | `#1f6fd6` | | `--nordic` | `#2a8c8c` |
| `--piste-intermediate` | `#d8251d` | | `--connection` (ski paths, walking) | `#5f6b75` |
| `--piste-advanced`, `--piste-expert` | `#111111` | | `--route-casing` | `#ffffff` |
| `--piste-freeride` (and `extreme`) | `#ef7d00` | | `--route-highlight` (hovered step) | `#ffe066` |
| `--piste-unknown` | `#7d7d7d` | | `--slope-lt10 / 10-25 / 25-40 / gt40` | `#2e9d3a / #1f6fd6 / #d8251d / #111111` |
| `--point-start` (A) | `#2e9d3a` | | `--point-stop` (B, C…) | `#1f6fd6` |
| `--point-end` (last) | `#d8251d` | | `--user-location` | `#007AFF` (also in dark) |

Engineers: in phase 1/4 treat `packages/core/src/ski.ts` as the one source and keep
`tokens.css` in sync with a unit test that reads both files and compares.

Colour swatches (legends, step icons) get `box-shadow: inset 0 0 0 .5px var(--swatch-border)` so black runs stay
visible on dark surfaces.

### 1.2 Glass recipe

One class, `.glass` (in `tokens.css`):

```css
.glass {
  background: var(--glass-fill);                       /* light rgba(250,250,252,.60) · dark rgba(30,30,34,.70) */
  backdrop-filter: blur(20px) saturate(180%);          /* + -webkit- prefix */
  box-shadow: var(--glass-rim), var(--glass-shadow);   /* 0.5 px top highlight + 0.5 px edge + soft shadow */
  color: var(--glass-label);
}
```

| Variant | How | When |
| --- | --- | --- |
| Regular | `.glass` | Tab capsule, search button, all round/capsule map buttons, mode pill, search field |
| Strong | `background: var(--glass-fill-strong)` (light .78 / dark .84) | Sheets at the medium detent, search results panel: text sits on it |
| Tinted | `background: var(--tint-fill)` (accent at 88 %), white label, same blur and shadow | Plan route button while plan mode is on |
| Moving fallback | `:root[data-map-moving]` → no blur, `--glass-fill-moving` (94 % opaque) | Only if profiling shows dropped frames (§5) |
| **Solid interface** | `:root[data-solid]` → `--glass-filter: none`, fill `#F9F9F9` / `#1C1C1E`, hairline border | In-app switch (Menu › Appearance), and `prefers-reduced-transparency` where supported |
| **Increase contrast** | `@media (prefers-contrast: more)` → fill 92–97 % opaque, 1 px solid border (45 % black / 55 % white), stronger secondary text | System setting |

The glass label colour is `#1C1C1E` / `#FFF`. Measured over the placeholder map, black on light glass is > 12:1 and
white on dark glass > 9:1 (glass over a white snow area is the worst case: still > 10:1).

### 1.3 Radii (concentric)

| Token | Value | Used by |
| --- | --- | --- |
| `--r-pill` | 999 px | Every capsule and circle: tab bar (64 → 32), tab pill (56 → 28), map buttons (48 → 24), mode pill (40 → 20), chips (26 → 13) |
| `--r-sheet` | 38 | Sheet top corners. At medium, bottom corners are 32 (= tab bar radius, so the sheet and bar look related). |
| `--r-cell` | 26 | Inset grouped sections (iOS 26 size, see owner screenshot) |
| `--r-card` | 22 | Search results panel, desktop popover, desktop info card |
| `--r-panel` | 24 | Desktop floating panel |
| `--r-md` | 12 | Text fields inside cells |
| `--r-icon` | 7 | 29 × 29 icon tiles in the Menu |
| `--r-sm` / `--r-xs` | 8 / 4 | Small chips in cells, swatches |

Rule: **inner radius = outer radius − padding.** Example: tab capsule 64 tall, padding 4 → selection pill 56 tall,
radius 28. Desktop: panel radius 24 with content padding 12 → cells inside use radius 24 − 12 = 12 (on iPhone cells
use `--r-cell` 26, because the sheet padding is 16 and the sheet radius 38 + optical correction).

### 1.4 Spacing

4-pt grid: `--sp-1…9` = 2, 4, 8, 12, 16, 20, 24, 32, 40.
Fixed layout values: `--edge` 16 (map controls from the screen edge, plus the safe area), `--cell-pad-x` 16,
`--cell-min-h` 44 (52 with an icon tile, 60 with a subtitle), gap between groups 24 (header included: 24 + header).
Sheet body horizontal padding 16.

### 1.5 Type

`system-ui, -apple-system, "SF Pro Text", …` (SF Pro on Apple devices). Numbers that change (stats, chips, markers)
use `font-variant-numeric: tabular-nums`; route stats and point letters use `--font-rounded` (SF Pro Rounded), like
Apple Maps / Fitness.

| Role (iOS style) | Token | Size / line | Weight | Used for |
| --- | --- | --- | --- | --- |
| Large title | `--t-large-title` | 34 / 41 | 700 | Menu root "Settings" |
| Title 1 | `--t-title1` | 28 / 34 | 700 | First-run title |
| Title 2 | `--t-title2` | 22 / 28 | 700 | Info card name; big stat values (22, rounded, 600) |
| Title 3 | `--t-title3` | 20 / 25 | 700 | Sheet titles ("Gipfel to Seealpe", "Map") |
| Headline | `--t-headline` | 17 / 22 | 600 | Sub-page title (centred), emphasised rows |
| Body | `--t-body` | 17 / 22 | 400 | Rows, search field, buttons in sheets (600) |
| Callout | `--t-callout` | 16 / 21 | 400 | Direction step titles; Plan route label (600) |
| Subheadline | `--t-subhead` | 15 / 20 | 400 | Leg summary, warnings, mode pill (600), segmented (500) |
| Footnote | `--t-footnote` | 13 / 18 | 400 | Section headers and footers, row subtitles, chips (600) |
| Caption 1 | `--t-caption` | 12 / 16 | 400 | Stat labels (600, uppercase, +0.3 tracking), chart legend |
| Caption 2 | `--t-caption2` | 11 / 13 | 400 | Chart axis labels |
| Tab label | fixed | 10 / 11 | 600 | Tab bar labels (do not scale) |
| Map credit | fixed | 10 | 400 | "© OpenStreetMap · OpenSkiData" |

### 1.6 Dynamic Type (approximation with rem)

- `html { font: -apple-system-body }` on touch devices in Safari sets the root size to the user's Dynamic Type body
  size (17 px by default, 14–23 px for the normal range, larger with accessibility sizes). All text inside **sheets,
  cards, lists and menus is in `rem`**, so it follows the setting.
- **Map chrome does not scale**: tab bar, map buttons, mode pill, markers are in px (iOS also keeps bars fixed).
  Their labels have a fixed px size and their `aria-label`s carry the meaning.
- Elsewhere the root is 17 px; desktop with a mouse (≥ 900 px) uses **15 px** for Mac density.
- Rows grow with the text (`min-height`, never fixed `height`). At root ≥ 23 px, value rows stack the value under the
  label (`flex-wrap: wrap`), and the three-column stats become a 2-column grid.

### 1.7 Layers (`z-index`)

`map 0` · `credit 5` · `controls 10` · `mode pill 15` · `sheet 20` · `tab bar 30` (floats over the sheet, also at
large) · `search 40` (field + results above the keyboard) · `modal 50` (Menu + scrim, desktop popover) · `toast 60` ·
`alert 70` (confirm dialogs) · `dev overlay 90`. MapLibre markers live inside the map container (below 5).

### 1.8 Motion

| Token | Value | Use |
| --- | --- | --- |
| `--spring-sheet` + `--dur-sheet` | `linear(…)` spring, response .4 / damping .82, 500 ms | Sheet detent changes and open/close, search field morph |
| `--spring-press` + `--dur-press` | response .25 / damping .7, 290 ms | Release after press, tab pill moving, switch thumb |
| `--dur-instant` | 100 ms, `--ease-out` | Press-in (scale to `--press-scale` 0.94) |
| `--dur-fast` | 150 ms | Fades, colour changes, compass fade |
| `--dur-base` | 250 ms | Small moves, toast in/out |

Map camera: `flyTo`/`easeTo` 600–800 ms (MapLibre default curve). After a sheet drag ends, the sheet keeps the
finger's velocity: choose the detent by projected end position (`y + velocity × 0.2 s`) and animate with
`--spring-sheet`.

**Reduced motion** (`prefers-reduced-motion: reduce`): springs become linear; sheets **fade** (200 ms) instead of
sliding, no press scale, tab pill jumps, map uses `jumpTo` instead of `flyTo`, the "searching for location" pulse is
off, compass appears/disappears without fade.

### 1.9 Touch targets

44 × 44 minimum. Visible shapes smaller than 44 (36 px round buttons in sheet headers, 28 px route markers, 22 px
remove icons) get an invisible hit area: `::before { content:''; position:absolute; inset:-4px }` (or more) so the
box reaches 44. Adjacent targets must not overlap: keep ≥ 8 px between visible shapes of 44 px targets.

### 1.10 Safe areas

`viewport-fit=cover`; read `env(safe-area-inset-*)` through `--safe-*`.

| Element | Position |
| --- | --- |
| Top controls | `top: calc(var(--safe-top) + 6px)` (59 + 6 = 65 on Dynamic Island phones) |
| Tab bar + search | `bottom: max(var(--safe-bottom) − 12px, 12px)` = 22 on Face ID phones (floats into the home indicator area, like iOS 26) |
| Plan + Locate row | `bottom: tab bar bottom + 64 + 24` = 110 (the 24 px gap holds the map credit line) |
| Sheet (large) | `top: calc(var(--safe-top) + 8px)` |
| Landscape | add `--safe-left/right` to every left/right offset (notch side) |
| Map | `position: fixed; inset: 0` under the status bar. The status bar style is `black-translucent`. |

The dev overlay (plan §2.1) sets `--safe-top: 59px; --safe-bottom: 34px` on `:root` to simulate an iPhone.

---

## 2. Components

All components: Svelte 5 components in `app/src/ui/`. States listed are required; "pressed" means `:active` on
touch and mouse. Hover styles only inside `@media (hover: hover)`. Focus: `:focus-visible` ring from `tokens.css`
(3 px accent 70 %, offset 2 px; follows the border radius).

### 2.1 GlassButton (round icon button)

```
  ╭────╮   48 × 48, radius 24, .glass
  │ ⌂  │   icon 22 px, stroke 2, colour --glass-label
  ╰────╯
```
- Props: `icon`, `label` (→ `aria-label`, required), `active`, `disabled`, `size` (48 default · 36 sheet header · 32 desktop).
- **Default:** glass, icon `--glass-label`. **Active / on:** icon `--accent`, icon filled where the icon allows (navigation arrow).
- **Pressed:** content scales to .94 (`--dur-instant`), an inner pill `--glass-pill-pressed` appears; release springs back (`--spring-press`).
- **Hover** (mouse): extra 4 % white (light) / 6 % white (dark) overlay.
- **Disabled:** icon at 35 % opacity, no press effect, `aria-disabled="true"`. On the map, prefer **hiding** a button over showing it disabled (see Undo).
- **Focus-visible:** ring around the circle.
- Size 36 (sheet headers): not glass, `background: var(--fill-3)`, icon 18 px stroke 2.4, colour `--label-2` (or `--accent` for Share). Hit area 44.

### 2.2 GlassCapsule (icon + label, or a group)

```
  ╭─────────────╮     ╭───────────────╮
  │  ⬡  3D      │     │  ↶  ┆  ↷      │   48 high, padding 0 4, segments 44 × 44 (radius 22)
  ╰─────────────╯     ╰───────────────╯   divider 0.5 × 24, --label-3
```
- One `.glass` surface; segments inside share its blur (**one blur per group**, plan §8.5).
- Label 15/700. Icon 22. Gap icon–label 6. Segment padding 0 10.
- **On** (3D on): icon + label `--accent`, `aria-pressed="true"`. Pressed / hover / focus per segment like 2.1.

### 2.3 TabBar (Route · Saved · Map)

```
 ╭──────────────────────────────────────╮ ╭──────╮
 │ ╭────────╮                           │ │      │
 │ │  ⤳     │    🔖          🗺          │ │  🔍  │   capsule 64 high, padding 4
 │ │ Route  │   Saved        Map        │ │      │   search circle 64, gap 10
 │ ╰────────╯                           │ ╰──────╯
 ╰──────────────────────────────────────╯
 ← 16 →                                         ← 16 →
```
- Capsule: `left: 16 + safe-left`, `right: 16 + 64 + 10 + safe-right`, height 64, `.glass`. Width on 393: **287**, on 430: **324**. Max width 440 (centred with the search circle on tablets).
- Items: three equal columns, 56 high, icon 24 (stroke 2) over label 10/600, gap 3.
- **Selected** (its sheet is open): pill `--glass-pill`, radius 28, icon + label `--accent`. The pill slides between tabs with `--spring-press` (one element, `transform: translateX`).
- **Pressed:** pill `--glass-pill-pressed` under the pressed item, content .94.
- No tab selected when no sheet is open (iOS 26 Maps style: the bar is a launcher here).
- Semantics: `role="tablist"` is wrong (no permanent panel). Use `<nav aria-label="Panels">` with buttons, `aria-expanded` + `aria-controls` the sheet, and `aria-current="true"` on the open one.

### 2.4 Search button and field

- Button: 64 circle, `.glass`, icon `search` 24. Label "Search". Desktop: not shown (search field is in the panel).
- Tap → the **search field** (52 high, radius 26, `.glass`, `left/right: 12`) morphs out of the button (scale/opacity from the button's position, `--spring-sheet`), the tab bar fades out (opacity 0, 150 ms), keyboard opens.
- Field anatomy: `search` icon 20 `--label-2` · input 17 (placeholder "Runs, lifts, places, coordinates") · clear/close round 36 button (`x`).
- Input attributes: `type="search"`, `enterkeyhint="search"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `autocomplete="off"`. Font size ≥ 16 to stop iOS from zooming the page (we use 17).
- **Results panel:** above the field, gap 8, `left/right: 12`, radius 22, strong glass, max height = space between field and `controls-top + 48 + 8`, scrolls. Rows 56 high: 29 px icon tile + title (17) + subtitle (13, `--label-2`). Tile colours: run = its piste colour, lift = `--lift`, place/peak = `--gray`, coordinates = `--teal` (`crosshair`), Google Maps link = `--red` (`map-pin`), "Search online for …" = `--accent` (`globe`), only in online mode.
- Keyboard: ↑/↓ move the highlight (row background `--fill-3`), Enter picks, Esc closes (desktop).
- States: empty query → recent searches? **No** (keep simple): show nothing. No hits → one row "No matches" / "Try another name, coordinates or a Google Maps link". Resolving a link → row with spinner "Resolving Google Maps link…". Offline mode + no hits → extra footnote "Online search is off. Turn on online mode in the menu."

### 2.5 Plan route button and mode pill

```
 ╭──────────────────╮                  ╭──────────────────────────────────────╮
 │ ✎  Plan route    │  (off: glass)     │ ✎  Tap the map to add points   (✕) │   pill 40 high
 ╰──────────────────╯                  ╰──────────────────────────────────────╯
 48 high, padding 0 18 0 14, label 16/600, icon 20
```
- **Off:** `.glass`, icon + label `--glass-label`. `aria-pressed="false"`.
- **On:** tinted (`--tint-fill`, white icon + label), same shadow. `aria-pressed="true"`.
- Pressed/hover/focus as 2.1. Desktop: label "Plan route" + `kbd` "P" (12/500, `--label-3`) when there is room.
- **Mode pill** (only while plan mode is on): centred in the free width of the second control row (`left: 16`, `right: 16 + 48 + 8`, so it never touches the compass), top = `controls-top + 56`. `.glass`, height 40, icon `pencil` 17 `--accent`, text 15/600 "Tap the map to add points", close button 32 (fill-3, `x` 17) "Stop planning". Appears with opacity + translateY(−6 → 0), 250 ms. With ≥ 2 points the text changes to "Tap to add a stop · drag a point to move it" — if that is too long (< 360 px wide screens) keep the short text.

### 2.6 Locate button (my location)

48 round GlassButton, bottom-right of the controls row.

| State | Icon (Lucide) | Colour | `aria-label` | Tap does |
| --- | --- | --- | --- | --- |
| Off (never asked, or not following) | `navigation` outline | `--glass-label` | "Show my location" | Ask permission (first time) → centre once → state *Centred* |
| Searching (waiting for first fix) | `navigation` outline, opacity pulse 1 → .4, 1 s (none with reduced motion) | `--accent` | "Finding your location" | Cancel |
| Centred (dot visible, map not following) | `navigation` outline | `--accent` | "Follow my location" | → *Follow* |
| Follow | `navigation` **filled** | `--accent` | "Follow my location and heading" | Ask compass permission (first time, needs this tap) → *Follow + heading* |
| Follow + heading | custom `location-heading` (filled arrow with a short line above, like SF `location.north.line.fill`), filled | `--accent` | "Stop following" | → *Off* (map rotates back to north with `easeTo`) |
| Denied / unavailable | `navigation-off` | `--label-3` | "Location is off" | Toast + a small info sheet (see copy §6) |

- Panning the map by hand while following → back to *Centred* (as Apple Maps). Rotating by hand in *Follow + heading* → *Follow*.
- If compass permission is refused, *Follow* goes back to *Off* on the next tap and a toast says "Compass is off".

### 2.7 Compass button

- 48 GlassButton, top-right under the 3D capsule: `top: controls-top + 56`, `right: 16`. Never cut off (fixes the native app issue).
- Content: needle 30 px: north half `--red` (triangle 8 × 11), south half `--label-3`; rotates with `rotate(-bearing deg)` on every map `rotate` event (transform only).
- Visible only while `|bearing| > 1°` (or in *Follow + heading*). Fade in 150 ms; after a reset to north, stay 1 s then fade out.
- Tap: `easeTo({ bearing: 0 })` (pitch is unchanged). In *Follow + heading*: switch to *Follow*.
- Label: "Map is turned. Tap to point north."

### 2.8 Undo / Redo

- Group capsule (2.2) left of the 3D capsule (gap 8). **Hidden when there is nothing to undo or redo** (fixes the almost-invisible disabled state). Shows `undo-2` only; grows to `undo-2 ┆ redo-2` when redo is possible. Width animates by fading the redo segment in and translating the capsule (no `width` animation; use a FLIP transform).
- Labels "Undo" / "Redo". After an undo, a toast "Undone: removed point C" is **not** shown (too noisy); the map change is the feedback.
- Desktop: same capsule, plus ⌘Z / ⇧⌘Z (Ctrl on Windows/Linux) and Ctrl Y.

### 2.9 BottomSheet

```
 ╭────────────────────────────────────╮  ← top corners 38
 │               ▬▬▬                  │  handle 36 × 5, --label-3, 6 from top (hit area 44 high, full width)
 │ Gipfel to Seealpe          (⇪) (✕) │  header ≥ 52: title 20/700, subtitle 13 --label-2; buttons 36, gap 8
 │ Oberstdorf · Changed since…        │
 │ ┌────────────────────────────────┐ │  body: padding 4 16 …, scrolls
 │ │ inset grouped content          │ │
 ╰────────────────────────────────────╯  ← at medium: bottom corners 32, 8 above the tab bar
```

**Detents (iPhone portrait):**

| Detent | Geometry | Surface |
| --- | --- | --- |
| Closed | off-screen (translateY 100 %) | – |
| **Medium** | `left/right: 8`, `top = round(0.475 × H)` (405 on 852, 443 on 932), `bottom = tab bar top − 8` | Strong glass. Cells use `--bg-cell` at 72 % so they stay solid-looking. |
| **Large** | `left/right: 0`, `top = safe-top + 8`, `bottom: 0` | Solid `--bg-grouped` (no blur: it covers the map anyway). Tab bar floats over the sheet; body has `padding-bottom: 120` and a **scroll-edge fade**: `mask-image` gradient over the last 130 px (no extra blur). |

- One element, height = large; detents are `transform: translateY()` values. The surface swap (glass ↔ solid) is a cross-fade of two backgrounds via opacity, done when the drag passes the halfway point. Corner and inset changes are done with `clip-path: inset(… round …)` animated by transform-driven progress, or simply switched at the end of the animation (acceptable).
- **Drag:** handle and header always drag. Body: below the top detent every drag moves the sheet; at large the body scrolls, and a downward drag when `scrollTop === 0` moves the sheet (plan §8.3). Use pointer events with `touch-action: none` on handle/header and `touch-action: pan-y` on the body; decide sheet-vs-scroll in the first 8 px of movement.
- Release: projected position (velocity × 0.2 s) picks the nearest detent; below medium − 80 px → close.
- **Close:** ✕ button, tapping the selected tab again, Esc (desktop), dragging down. Opening another tab swaps the content in place (cross-fade 150 ms, detent kept).
- **Map padding follows the sheet:** on every settled detent, `map.setPadding({ bottom: H − sheetTop, top: controls-top + 56 })` and, if a route is shown, `fitBounds` with that padding (only when the route would be hidden). During the drag do **not** update padding (performance).
- **Controls riding on the sheet:** at medium, the Plan button and Locate button sit 16 px above the sheet top (`translateY` with the sheet). Between medium and large they fade out (opacity follows progress). The credit line hides while a sheet is open (credits are in Menu › About).
- Header actions per sheet: Route → Share (`share`, accent) + Close; Saved → Edit (text button "Edit" / "Done", 17/400 accent) + Close; Map → Close; Info card → Close.
- Semantics: `role="dialog"`, `aria-modal="false"` (map stays usable), `aria-labelledby` the title. Focus moves to the title when opened by keyboard, back to the tab when closed.

### 2.10 Inset grouped list

| Part | Spec |
| --- | --- |
| Section header | 13/400 `--label-2`, sentence case (not uppercase, iOS 26), margin 0 16 7. "Big" header variant (Directions on desktop): 20/600 `--label` |
| Group | `--bg-cell`, radius 26, overflow hidden, margin-bottom 8 |
| Section footer | 13 `--label-2`, line 1.38, margin 0 16; gap to next header 24 |
| Row | min-height 44, padding 10 16, gap 12; title 17; subtitle 13 `--label-2`; separator 0.5 px `--separator`, inset to the text start (16, or 57 with an icon tile, 56 with a point badge) |
| Pressed row | background `--bg-cell-pressed` (instant in, 150 ms out) |
| Hover (mouse) | background `--fill-4` |
| **Toggle row** | title + Switch (2.11) at the end; the whole row toggles; `role="switch"` on the switch, row is its label |
| **Checkmark row** | title; `check` 20 px stroke 2.6 `--accent` on the chosen one; group is `role="radiogroup"`, rows `role="radio"` + `aria-checked` |
| **Chevron row** | optional 29 px icon tile (radius 7, white glyph 18), title, value (17 `--label-2`), `chevron-right` 14 stroke 3 `--label-3`. Opens a sub-page |
| **Value row** | title + value right (17 `--label-2`), not tappable |
| **Destructive row** | title in `--red`, no icon; always asks for confirmation (2.24) |
| **Button row** | title in `--accent` ("Import data file…") |
| Field row | label left (17) + input right-aligned or full-width input with placeholder (17), height 44 |

### 2.11 Switch

51 × 31, radius 16. Track off `--fill-1`, on `--green`. Thumb 27 × 27 white, inset 2, shadow `0 3px 8px rgba(0,0,0,.15), 0 3px 1px rgba(0,0,0,.06)`. Thumb moves with `--spring-press` (transform), track colour 150 ms. While pressed the thumb widens to 33 (transform: scaleX on a pseudo-element). Disabled: 40 % opacity. Use a real `<input type="checkbox" role="switch">` visually replaced. Increase contrast: add a 1 px `--label-3` border to the off track.

### 2.12 Segmented control

Track `--fill-2`, radius 9, padding 2, height 32 (compact 28). Segments equal width, 13/500 (compact 12). Selected: `--bg-elevated` (dark `#636366`), radius 7, 13/600, shadow `0 3px 8px rgba(0,0,0,.12)`; the selected thumb slides (`--spring-press`). `role="radiogroup"`. Used for: profile colour (Official / Steepness), speed preset (Beginner / Intermediate / Confident), desktop panel tabs, desktop route storage (This device / Project folder).

### 2.13 Info card (sheet content)

Shown in the sheet when you tap a run, lift or place in explore mode, or pick a search result.

```
 Nebelhorn Gipfelabfahrt               (✕)     title 22/700; subtitle row: difficulty pill + type
 ● Red run · Oberstdorf                        pill: 20 high, piste colour bg, white 12/600 "Red"
 ┌─────────────┬─────────────┬────────────┐
 │ LENGTH      │ DESCENT     │ STEEPEST   │    stats as in 2.15
 │ 3.1 km      │ 820 m       │ 41%        │
 └─────────────┴─────────────┴────────────┘
 ┌────────────────────────────────────────┐
 │ Use this spot in your route            │    footnote header
 │ [ Start here ]  [ Add as stop ]  …     │    buttons 36 high; first one filled accent, others fill-3
 └────────────────────────────────────────┘
 (large detent) All details: value rows, elevation profile (2.17, read-only colours), lift times, …
```
- Actions follow today's planner (`pinActions`): 0 points → "Start here"; 1 point → "Go here (destination)", "Replace start"; ≥ 2 → "Set as destination", "Add as stop", "Add after destination", "Replace start". The first is the primary (filled accent).
- While open, the feature is highlighted on the map (`--route-highlight` halo) and the tab bar has no selection. Closing returns to the previous tab sheet if one was open.
- Lift card: subtitle "Chairlift · 6 seats", stats Length / Rise / Ride time. Place: name, type, elevation.

### 2.14 Route points list

Group of point rows: badge 26 (round, `--point-*` colour, white 13/700 rounded letter) · title (nearest name: "Nebelhorn top station", else "47.40912, 10.27645" in tabular nums) · subtitle role "Start" / "Stop" / "Destination" · remove `circle-x` 22 `--label-3` (hit 44, label "Remove point B").
Under the group: button row (36 high capsules, `--fill-3`): **Reverse** (`arrow-up-down`, accent; disabled < 2 points) · **Clear** (`trash-2`, red; disabled with 0 points; no confirm, undo exists). Reorder: drag a row by long-press 300 ms (row lifts: scale 1.02, shadow) — phase 6+, optional.

### 2.15 Route summary (stats + chips)

- Group with three **big stats**: Time · Distance · Descent. Label 12/600 uppercase `--label-2`; value 22/600 rounded tabular, unit 15/600 `--label-2` ("42 min", "8.4 km", "1210 m"). Columns divided by 0.5 px separators.
- **Chips** row below: "5.1 km skiing", "2 lifts", "↑ 290 m", "avg 21%", "max 38%" (titles as today's planner for the gradient chips). Chip 26 high, radius 13, `--fill-3`, 13/600. **One line, scrolls horizontally** (no wrap), no scrollbar.
- Medium detent order: summary → points → warnings → profile → directions → route settings row.

### 2.16 Warnings and errors

- Warning row inside a group: `triangle-alert` 20 `--orange` + text 15/20. One row per warning, text from the router.
- Error (no route): replaces summary + profile + directions with an empty-state block (2.23) with icon `triangle-alert` `--red`, title "No route found", body = router message, button "Route settings".

### 2.17 Gradient / elevation chart with touch scrubbing

```
 Gradient profile                     [Official|Steepness]   ← header 50 high
 2200 ┤▇▇▇▇▇▆▅▄▃              │                              y labels 11 --label-2, 3 lines
 1600 ┤          ▃▄█▇▆▅▄▃▂    ●   ← knob on the profile line
 1000 ┤________________________│__
      0     2 km     4 km     6 km    8.4 km                  x labels 11
 ■ Red  ■ Black  ■ Lift  ■ Path / walk                        legend 12
```
- Size: width = cell − 16 right − 44 left (y labels), height 128 (large detent / desktop 160). SVG with `preserveAspectRatio="none"`; strokes `vector-effect: non-scaling-stroke`. Gridlines 0.5 px `--separator`.
- Areas filled per segment with the official or steepness colour at 85 % opacity; profile line 1.5 px `--label` at 60 %.
- **Scrubbing:** `touch-action: pan-y` on the chart so vertical swipes scroll the sheet and horizontal drags scrub. Pointer down + horizontal move > 6 px starts scrubbing (mouse: hover scrubs, as today).
  - Cursor: vertical line 1.5 px `--label`, full chart height; knob 12 px white with 3 px `--label` border on the profile.
  - **Readout replaces the chart header** while scrubbing (no floating bubble that could cover the header or leave the cell): swatch + "34% · 1655 m" 15/600, second line 12 `--label-2` "at 5.2 km · Black run · Höfatsblick-Abfahrt".
  - **Map marker** at the same point: 14 px white circle with 3 px `--label` (`#1d2329`) border, shadow — the existing `profile-cursor`. The map does **not** move while scrubbing; if the point leaves the visible area, the map pans with `easeTo` 300 ms only after the finger stops for 400 ms.
  - Release: cursor, knob, readout and map marker stay 1 s, then fade (150 ms). Tap without drag: show the point, same timeout.
  - Keyboard (desktop): chart is focusable (`tabindex=0`, `role="img"` + description); ←/→ move the cursor by 1 % (Shift: 10 %).
- `aria-label`: "Gradient profile. Drag along it to see a point on the map." Summary for screen readers: "From 2224 m to 940 m, steepest 41 %".

### 2.18 Directions per leg (collapsible)

- One group per leg. Header row (52): badges 20 ("A" → "B"), meta 15 `--label-2` "~18 min · 3.2 km · ↓ 610 m", `chevron-down` 16 `--label-3` (rotated −90° when collapsed, 250 ms). Tap toggles; state is remembered (as today).
- Step rows: icon tile 24 radius 7 — run: piste colour + white step number 12/700; lift: `--lift` + `arrow-up` (or `arrow-down` when riding down); walk / ski path: `--connection` + `footprints`; title 16 ("Ski Gipfelabfahrt", "Take Koblat-Sesselbahn", "Walk", "Follow the ski path"), meta 13 `--label-2` (today's `stepMeta`). Separator inset 52.
- Tap a step: map zooms to it (`fitBounds`, sheet padding), sheet goes to medium; the step gets `--route-highlight` on the map for 2 s. Hover (mouse): highlight while hovered (as today).
- Empty leg: one row "Both points are at the same spot."

### 2.19 Toast

Solid (no blur), `--toast-bg` / `--toast-label`, 15/500, padding 10 16, radius 20, max-width 340, centred, `top: controls-top + 56` (under the top row; above the mode pill when both show). In: opacity + translateY(−8 → 0) 250 ms; stays 3 s (6 s if it has an action); out 150 ms. Optional action: text button 15/600 `--accent` (dark: `#0A84FF` on light toast) e.g. "Undo". `role="status"`. One at a time; a new toast replaces the old one.

### 2.20 Empty states

Centred block in the sheet body: icon 40 (stroke 1.75) `--label-3`, title 17/600, body 15 `--label-2` (max 280 wide), optional button (36 high, filled accent for the main action, else fill-3).

| Where | Icon | Title | Body | Button |
| --- | --- | --- | --- | --- |
| Route, no points | `route` | Plan a route | Tap **Plan route**, then tap the map: first the start, then the destination. | **Start from my location** (filled, `locate-fixed`) · second button "Plan route" (fill-3) when plan mode is off |
| Route, 1 point | – (no block) | – | Point list + hint row "Now tap the map to set the destination." | – |
| Saved, nothing saved | `bookmark` | No saved routes | Routes you save appear here, grouped by folder. | – |
| Search, no hits | – | No matches | Try another name, coordinates or a Google Maps link. | – |
| App, no data imported | see first-run screen §3.9 | | | |

### 2.21 Import progress

Inside Menu › Data (and the first-run screen). Card group: "Importing data…" 17/600 + percent right (17 `--label-2`, tabular); detail line 13 `--label-2` ("Checking the file…", "Copying terrain.pmtiles · 186 of 300 MB", "Checking files…", "Finishing…"); progress bar 6 high radius 3, track `--fill-1`, bar `--accent` (`transform: scaleX`, origin left). Row below: "Cancel import" (red). Footer: "Keep the app open until the import is done. Your current data stays until the new data is ready." While importing: "Import data file…" row disabled (40 %). Done: toast "Data imported" and the group shows a `check` in `--green` with "Imported 18 Nov 2026 data". Error: group with `triangle-alert` `--red` + message + "Try again".

### 2.22 Menu (iOS Settings style)

- iPhone: **modal large sheet** over a scrim (`--scrim`), `z: modal`, covers the tab bar. Root page: close button (36, top-right) then **large title** "Settings" (34/700), then groups with chevron rows + 29 px icon tiles. Sub-pages push in from the right (translateX 100 % → 0, `--spring-sheet`; root moves −30 % and dims). Sub-page header: back button (`chevron-left` 24 + previous title 17, accent, min 44) · centred title 17/600 · close 36.
- Swipe from the left edge (first 20 px) goes back, like iOS.
- Tile colours: Resort `--green` `mountain-snow` · Online mode `--accent` `globe` · Data `--gray` `hard-drive` · Routes backup `--orange` `archive` · Appearance `--indigo` `sun-moon` · gpx.studio `--teal` `link` · About `--gray` `info`.
- Desktop: popover (2.26).

### 2.23 Confirm dialog (alert)

For destructive actions (Delete data, Delete saved route from the Edit mode, Import backup that replaces). iOS-style alert: 270 wide, radius 22, `--bg-elevated` at 96 % (no blur), title 17/600 centred, message 13, buttons 44 high stacked/side by side, destructive button text `--red`, cancel 17/600 accent. Scrim `--scrim`. Focus trapped; Esc = Cancel. Use `<dialog>`.

### 2.24 Map markers (route points)

- 28 round, piste-independent colours: A `--point-start` (green), middle `--point-stop` (blue), last `--point-end` (red). Border 2.5 white, shadow `0 2px 6px rgba(0,0,0,.35)`, letter 13/700 rounded white. Letters after Z: "AA", "AB" … (as today).
- Hit area 44 (transparent padding around the circle).
- **Drag (touch):** the marker lifts as soon as the finger is down on it for 150 ms or moves: `translateY(-26px) scale(1.2)`, bigger shadow, a 2 px stem and a small ground shadow show the real point under the finger (the finger never covers the point). Map pan is blocked while dragging. Drop: marker settles with `--spring-press`; route recomputes.
- **Drag (mouse):** as today (no lift).
- **Tap on a marker:** iPhone → opens the Route sheet (medium) and flashes that point row (`--fill-3` for 600 ms); desktop → removes the point (as today, title "Start: drag to move, click to remove").
- **Search pin** (search result not yet used): 32 `map-pin` shape in `--red` with white dot (Apple style), bounces in once (none with reduced motion).

### 2.25 User location (MapLibre layers)

- **Dot:** circle 18 (radius 9) `--user-location`, white stroke 3, shadow `0 1px 4px rgba(0,0,0,.35)`. Stale fix (> 30 s): fill `--user-location-stale`.
- **Accuracy circle:** geographic radius = `coords.accuracy` metres, fill `--user-location` 13 %, stroke 1 px 30 %; hidden when it is smaller than the dot or > 2 km.
- **Heading cone:** only when a compass heading is known: wedge 64 long, 70° wide (narrows to 40° with good `webkitCompassAccuracy` < 15°), radial gradient `--user-location` 55 % → 0, rotated to the heading relative to the map bearing.
- **Searching:** the dot pulses (scale 1 → 1.15, 1 s) until the first fix; static with reduced motion.
- Draw with a symbol layer from a canvas image (dot + cone) + a circle layer for accuracy, so it stays sharp and needs no DOM per frame.

### 2.26 Desktop popover and floating card

- Popover (Menu, desktop): 380 wide, max-height `min(640px, 80vh)`, radius 22, `--bg-elevated` (solid), shadow `0 12px 40px rgba(0,0,0,.18)`, 0.5 px border `--separator`, arrow-less, 8 px below its button. Same pages as the iPhone menu (navigation inside the popover). Closes on Esc, click outside, or the button again.
- Info card on desktop: floating card at the top-right of the map area, under the map toolbar, 340 wide, max-height 60 vh, header glass + solid body (same content as 2.13).

### 2.27 Credit line

"© OpenStreetMap · OpenSkiData" 10/400, `rgba(0,0,0,.62)` with a 2 px white text halo (no box), centred horizontally, 5 px above the tab bar. Tap → Menu › About & credits. Hidden while any sheet is open. The MapLibre `AttributionControl` is **off** (credits are in About). Desktop: bottom-right of the map, 11 px, same text, plus "· Credits" link.

---

## 3. Screens

### 3.1 Main map, iPhone portrait (393 × 852; 430 × 932 in brackets)

```
 0 ┌─────────────────────────────────────────────┐
   │ 9:41          ▀▀▀▀▀▀▀▀▀          ▂▄▆ ▭      │ status bar over the map (safe-top 59)
65 │ (≡)                     ╭ ↶ ┆ ↷ ╮ ╭⬡ 3D╮    │ row 1: 48 high. menu · undo/redo · 3D
   │                         ╰─────╯ ╰────╯     │
121│     ╭ ✎ Tap the map to add points (✕)╮ (N) │ row 2: mode pill (plan mode) · compass (rotated)
   │     ╰─────────────────────────────────╯     │
   │                                             │
   │                  M A P                      │
   │                                             │
694│ ╭✎ Plan route╮                        (➤)  │ controls row, bottom 110 (48 high)
   │ ╰────────────╯                              │
747│          © OpenStreetMap · OpenSkiData      │ credit, 5 above the tab bar
766│ ╭─────────────────────────────────╮ ╭────╮ │ tab bar 64, bottom 22
   │ │  ⤳ Route    🔖 Saved    🗺 Map   │ │ 🔍 │ │
830│ ╰─────────────────────────────────╯ ╰────╯ │
   │                 ▬▬▬▬▬▬▬                     │ home indicator
852└─────────────────────────────────────────────┘
    16 ← capsule 287 (324) → 10 ← 64 → 16
```
- Menu (≡) shows a 10 px status dot at its top-right when **online mode** is on (`--accent`), or **orange** when online mode is on but there is no network.
- Undo/redo capsule only when there is something to undo/redo. 3D capsule always.
- Glass surfaces at rest: menu, 3D, plan, locate, tab bar, search = **6**; + undo, compass, mode pill when relevant (max 9, all small; see §5).

### 3.2 Route sheet

**Medium, with a route** — see `route-sheet-medium.png`:
```
 ╭───────────────── ▬ ─────────────────╮
 │ Gipfel to Seealpe            (⇪)(✕) │   title = saved route name, else "Route"
 │ Oberstdorf · Changed since you saved it   (orange part only when changed)
 │ ┌─────────────────────────────────┐ │
 │ │ TIME     │ DISTANCE │ DESCENT    │ │
 │ │ 42 min   │ 8.4 km   │ 1210 m     │ │
 │ │ (5.1 km skiing)(2 lifts)(avg 21%)…│ │   chips scroll sideways
 │ └─────────────────────────────────┘ │
 │ ┌─────────────────────────────────┐ │
 │ │ (A) Nebelhorn top station    ⓧ  │ │
 │ │     Start                       │ │
 │ │ (B) Höfatsblick              ⓧ  │ │
 │ │ (C) Seealpe                  ⓧ  │ │
 │ └─────────────────────────────────┘ │
 │ (⇅ Reverse) (🗑 Clear)               │
 ╰─────────────────────────────────────╯
```
**Large** — see `route-sheet-large.png`: scrolls on with warnings, Gradient profile (2.17), "Directions" header + one group per leg (2.18), then a group with one chevron row **Route settings** (`sliders-horizontal` tile `--gray`) and the footer "Times use your speed setting. Always check the piste map and the conditions on the day."

**Route settings** sub-page (pushes inside the sheet, back button "Route"): as the native `RouteSettingsView` and today's planner:
- **Runs** — 2-column grid of check boxes with colour swatches (Green, Blue, Red, Black, Black ◆◆, Freeride, Unknown); footer "Runs you are allowed to ski." Then toggle rows "Prefer easier runs", "Use ski paths".
- **No route found?** — checkmark rows "Use harder runs (with a warning)" / "Show no route".
- **Lifts** — toggle per lift type (Gondola, Chairlift, Train, T-bar, Button lift, Rope tow, Magic carpet), "Avoid drag lifts", "Ride lifts down" (+ indented types when on), value row "Waiting time per lift" with − / + stepper (0–30 min, step 1).
- **Speed** — segmented Beginner / Intermediate / Confident; footer "Your average speed with short stops. Used for times and for choosing between runs."; chevron row "Speed per run colour" → sub-page with number fields (km/h).
- **Advanced** — slider row "Max walk between runs and lifts" 0–150 m with value; footer "In the map data, runs and lifts do not always touch. The route may walk this far to connect them."

**Empty** (no points): empty state 2.20 at medium. The second button "Plan route" (only when plan mode is off) turns plan mode on and keeps the sheet at medium, so the map above is tappable.
**Error**: header as usual, then the error block (2.16), then points list (so the user can fix them), then Route settings row.

### 3.3 Saved sheet

```
 Saved routes                          Edit (✕)
 Current route
 ┌──────────────────────────────────────────┐
 │ Name          Gipfel to Seealpe          │  field rows
 │ Folder        Oberstdorf            ⌄    │  folder: text + menu of existing folders
 │ Save route                                │  button row (accent); "Save changes" + "Save as new route" when a saved route is open
 └──────────────────────────────────────────┘
 Saved on this iPhone only. Export a backup in the menu.      (desktop: storage segmented above: This device | Project folder)
 Oberstdorf                                   ← folder header
 ┌──────────────────────────────────────────┐
 │ Gipfel to Seealpe                    ✓   │  ✓ (green check-circle) = open now
 │ 3 points · 8.4 km · 18 Nov                │
 │ Family day                                │
 │ 5 points · 12.1 km · 2 Nov                │
 │ Share folder (ZIP)                        │  button row, accent, `share`
 └──────────────────────────────────────────┘
```
- Tap a route: opens it (points + route), sheet switches to the **Route** tab at medium. Swipe left on a row: red "Delete" action (80 wide); full swipe deletes. **Edit** mode (header button) shows red ⊖ before each row and "Delete" — the accessible alternative to swiping (no confirm; toast "Route deleted · Undo").
- With < 2 points: the Current route group shows "Plan a route with a start and a destination to save it." (`--label-2`).

### 3.4 Map sheet

As the owner screenshot (`map-sheet-dark.png` compares directly). Groups: **Show** (Ski runs, Lifts, Cross-country, Touring & sled) · **Run colours** (Official difficulty / Steepness, checkmarks; steepness legend in the footer) · **Extra** (Ski areas in colour [+ footer legend "Tap an area name on the map to zoom to it."], Route arrows, Route distances) · **Terrain** (3D terrain; footer "Tilts the map to show the mountains. Tilt with two fingers.") · **Base map** — only when online mode is on: checkmarks "Ski map (offline)", "OpenSnowMap", "OpenFreeMap + pistes"; footer for OpenSnowMap: "The run and lift lines are pictures here, so they can't be tapped, hidden or coloured by steepness. Routing works as usual." When online mode is off: one footer line "Turn on online mode in Settings to use online maps."
Changes apply live; the sheet stays open (medium shows the map above).

### 3.5 Menu and sub-pages

Root (see `menu.png`):

| Group | Rows | Footer |
| --- | --- | --- |
| 1 | **Resort** › (value: current) · **Online mode** (switch) | "Off: everything works without internet. On: adds online maps and online search." |
| 2 | **Data** › (value: space used) [PWA only] · **Routes backup** › · **Appearance** › | – |
| 3 | **gpx.studio** › [desktop build only] | – |
| 4 | **About & credits** › (value: version; red badge "Update" when a new version is waiting) | "Always check the piste map and the conditions on the day." |

Sub-pages:
- **Resort:** checkmark rows, one per imported resort (name + footnote "Built 18 Nov 2026"). Footer "To add a resort, build a new data file with it and import it." Picking flies the map to the resort.
- **Online mode** is a switch on the root page (no sub-page). When switched on without network: toast "No internet. Using the offline map."
- **Data** (PWA, see `menu-data.png`): import progress group (when running) · **Installed data** value rows: Resorts, Built on, Detail level ("Terrain z13 · Map z13"), Space used, Free space, Protected from clean-up (Yes/No) + footer · button row **Import data file…** · destructive row **Delete data** (confirm: "Delete all map data? Your saved routes stay. You need to import a data file again to use the app." [Delete] [Cancel]). Dev builds add a row **Load data from build/** (accent).
- **Routes backup:** button rows **Export backup** (`share` sheet with the JSON file) · **Import backup…** (file picker; then alert "Add 12 routes from the backup?" [Add] [Cancel]). Footer "A backup is one file with all your saved routes. Keep it in Files or iCloud Drive." Desktop build: also "Copy all to this browser" when project-folder storage is on.
- **Appearance:** toggle **Solid interface** (footer "Shows the buttons and panels without see-through effect. Easier to read; may also save battery."), toggle **Keep screen on while planning** (Wake Lock, PWA), value row **Units** "Metric". Dark mode follows the iPhone setting (footer line says so).
- **gpx.studio** (desktop only): hint "In gpx.studio: Map layers ⚙ → Custom layers. Paste a link." then four rows, each: title ("Map (JPG)", "Runs and lifts only (PNG)", "Map, steepness colours (JPG)", "Runs and lifts, steepness colours (PNG)"), the URL in 13 mono `--label-2` (one line, ellipsis), and a **Copy** button (36 high capsule, fill-3, accent → "Copied" with `check` for 1.5 s).
- **About & credits:** logo 64 + "Ski route planner" + version · row "Update available — Reload" (when waiting) · group **Data sources** (OpenSkiData, OpenStreetMap contributors (ODbL), Skimap.org, Who's On First, Mapterhorn, Protomaps; online: OpenStreetMap tiles, OpenFreeMap, OpenSnowMap (CC-BY-SA)) as link rows · footer "Always check the piste map and the conditions on the day."

### 3.6 Info card

Explore mode tap → the sheet opens at medium with the info card (2.13); the tapped feature is highlighted on the map, and the map pans (with padding) so the feature is in the visible area. Large: all details and the elevation profile.

### 3.7 Search

See `search-iphone.png`. Field 10 px above the keyboard, results above it. Pick a result → keyboard closes, field morphs back into the button, map flies to the result, a search pin drops and the **info card** opens (medium) with its "Use this spot in your route" actions. In plan mode it is the same (results never add points by themselves; the card actions do).

### 3.8 Explore vs plan visual differences

Plan mode on: Plan button tinted, mode pill visible, map cursor (desktop) `crosshair`. Plan mode off: no pill; desktop cursor `pointer` over features.

### 3.9 First run / no data

Full screen, no map (see `onboarding.png`). Logo 96 (radius 22, shadow) · "Ski route planner" (28/700) · lead 17 `--label-2` "Plan ski routes on your iPhone, also offline. First, add the map data." · numbered steps group (1–3) · footer tip (only in Safari, not when installed: `display-mode: standalone` false) "Tip: add this app to your Home Screen first (Share › Add to Home Screen). The data is safer there." · primary button 50 high, full width, filled accent: **Import data file**. During import the steps group is replaced by the import progress group (2.21). Dev builds: second button "Load data from build/". When done: the map fades in, centred on the resort, and the Route sheet opens at medium with the empty state.

### 3.10 Landscape iPhone (height < 500)

- Sheets dock **left** as a panel: `left: 8 + safe-left`, `top: 8`, `bottom: 8`, width 360, radius 24, strong glass; tabs become a segmented control in the panel header (like desktop). No bottom tab bar; the search button moves to the panel header (icon button).
- Map controls: right column, `right: 16 + safe-right`: 3D, undo, compass (top) · locate (bottom). Plan button bottom-left of the **map area** (right of the panel).
- Map padding left = panel width + 16.

### 3.11 Desktop (≥ 900 px wide)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ╭ panel 380 ──────────────────╮   ╭✎ Plan route  P╮ ╭↶┆↷╮ ╭⬡ 3D╮                    │
│ │ (🔍 Search runs, lifts… ⌘K)(≡)│   ╰──────────────╯ ╰───╯ ╰────╯                    │
│ │ [ Route | Saved | Map ]     │              ╭ ✎ Click the map to add points · P ✕╮ │
│ ├─────────────────────────────┤                                               (N)  │
│ │ solid content (same as the  │                     M A P                     (+)  │
│ │ sheets, 15 px root)         │                                               (−)  │
│ │                             │                                               (➤)  │
│ ╰─────────────────────────────╯                         © OpenStreetMap · Credits   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- Panel: `left/top/bottom: 12`, width 380, radius 24. Header is glass (blur), body solid `--bg-grouped`, scrolls. Header: search field (36 high, radius 10, `--fill-3`, `kbd` "⌘K" / "Ctrl K") + menu GlassButton 32; then the segmented control (32) for Route · Saved · Map (always one selected: the panel is never "closed"; a `panel-left` button in the map toolbar hides/shows the panel).
- Search results drop down under the field inside the panel (solid, radius 12, shadow).
- Map toolbar (glass, 36 high capsules) at the top of the map area: Plan route (with "P"), Undo/Redo, 3D. Right column (bottom-right): compass (when rotated), zoom +/− group (vertical capsule, `plus`/`minus`), locate. All 36 visual / 44 hit not required with a mouse but kept ≥ 32.
- Info card: floating card (2.26). Menu: popover (2.26).
- Hover: rows `--fill-4`; buttons +4 % overlay; direction steps and legs highlight on the map (today's behaviour); chart scrubs on hover.
- Between 600 and 899 px (tablet, small window): iPhone layout, sheet max-width 560 centred, tab bar max-width 440 centred.

---

## 4. Interaction rules

1. **Plan vs explore (decided, plan §8.2).** Plan mode on: every tap/click on the map adds a point at the end (A, B, C…), also on a run or lift. Off: a tap on a run, lift or place opens its info card; a tap on empty map does nothing (desktop: shows a toast once per session "To add points, press ✎ Plan route (P).", as today). Info cards and search results can add points in both modes. Plan mode stays on until switched off (✕ in the pill, the button, P, Esc).
2. **Sheets and tabs.** Tap a tab → its sheet opens at medium (or the detent it had last time this session). Tap the selected tab → sheet closes. Tap another tab → content swaps, detent kept. Only one sheet at a time (Menu is modal above it; info card replaces the tab content temporarily and has no tab selected).
3. **Tab bar when a sheet is large:** it **stays visible**, floating over the sheet (z 30), so you can switch tabs; the sheet content fades out under it (mask). The search button stays too. The Menu (modal) covers both.
4. **Map while a sheet is open:** fully interactive above the sheet. Tapping the map with a sheet at **large** moves it to medium first (the tap is used for that only). With a sheet at medium, plan-mode taps add points as usual.
5. **Search keyboard on iOS.** Position the field from `visualViewport`: `bottom = innerHeight − (vv.height + vv.offsetTop) + 10`, updated on `vv.resize`/`scroll`. Do not use `100vh`/`dvh`. Blur the input when a result is picked or the map is touched (keyboard closes). After the keyboard closes, reset `window.scrollTo(0, 0)` (iOS 26 viewport-shift bug, plan §8.6). Results are limited to the space above the field.
6. **Feedback without haptics.** Every action has visible feedback within 100 ms: press scale + pill; added point drops in (scale .6 → 1, `--spring-press`); removed point shrinks out (150 ms); route line appears with a 150 ms fade; switch thumb springs; copied → "Copied". `navigator.vibrate` is not used (not on iOS).
7. **Desktop keyboard and focus.** P toggles plan mode (not while typing) · Esc closes the top-most layer in this order: alert → popover/menu → search results → info card → plan mode · ⌘K / Ctrl K focuses search · ⌘Z, ⇧⌘Z / Ctrl Y undo/redo · ↑/↓/Enter in search results. Tab order: panel header → panel content → map toolbar → map controls. Focus is never lost on close (return it to the opener).
8. **Accessibility.**
   - Every icon-only button has an `aria-label` from §6; toggles use `aria-pressed`; tabs use `aria-expanded` + `aria-current`.
   - Route markers have `role="button"` and `aria-label` "Point B, stop, Höfatsblick. Drag to move." On iPhone VoiceOver users edit points in the Route sheet list (remove, reverse); the map itself is `aria-hidden` except markers.
   - Live regions: route summary changes announce "Route: 42 minutes, 8.4 kilometres" (`aria-live="polite"`, debounced 1 s); toasts are `role="status"`; import progress uses `role="progressbar"` with `aria-valuenow`.
   - Contrast: all text ≥ 4.5:1 on its surface (checked for both themes in the mockups); glass label colours pass on the worst map background (white snow) thanks to the fill opacity; `prefers-contrast: more` makes fills nearly opaque.
   - Dynamic Type via rem (§1.6). Reduced motion (§1.8). **Solid interface** switch (Menu › Appearance) sets `data-solid` on `<html>` and is saved in settings.
   - Sheets are drag-free usable: ✕ closes, and a VoiceOver "escape" (two-finger Z) closes the sheet (listen for Escape key and the `cancel` event).
9. **Landscape / rotation:** keep the sheet's content and scroll position; switch layout without animation.

---

## 5. Performance rules for glass over the WebGL map

1. **Blur budget:** ≤ 6 blurred surfaces in the normal state, ≤ 9 at peak, and the **total blurred area ≤ 30 % of the viewport** (the cost is mostly area). Count: menu 48², 3D, plan, locate, tab bar, search = 6; undo, compass, mode pill add small areas. The medium sheet is the only big blurred surface; when it is open the controls it covers are not rendered (`visibility: hidden`, not only opacity 0).
2. **Groups share one blur** (undo+redo capsule, tab capsule with its three items). Never put `backdrop-filter` on children.
3. **Never animate blur or its radius.** Animations: transform and opacity only. Do not animate `opacity` on an element **with** `backdrop-filter` below 1 for long (fades ≤ 150 ms), WebKit re-renders the backdrop for each frame of an opacity fade.
4. **Large sheet is solid** (no blur). Search results panel: strong glass but only while visible. Toasts and alerts: solid.
5. **While the map moves:** measure first (phase 7, real iPhone, Safari Web Inspector timeline, 60 fps target while panning with the medium sheet open). Only if frames drop: set `data-map-moving` on `<html>` on `movestart`, remove it 150 ms after `moveend`. The CSS in `tokens.css` swaps blur for a 94 % opaque fill (not on the sheet). The swap must not cause layout.
6. Promote fixed glass elements once (`will-change: transform` on the sheet only while dragging; not on everything).
7. Markers: use MapLibre `Marker` DOM only for the route points (few). Location dot, accuracy, profile cursor are layers or one marker.
8. `blur(20px)` is the maximum. Smaller controls may use 16 px if profiling asks for it (visually the same at 48 px).

---

## 6. Copy

Simple English, short, consistent with today's planner. Sentence case everywhere. Use "tap" on touch and "click"
on desktop (two strings where shown). Numbers: `8.4 km`, `1210 m`, `~42 min`, `21%`; thousands without separator
below 10 000 (as today).

| Where | Text |
| --- | --- |
| Tabs | Route · Saved · Map |
| Search button / field placeholder | Search · Runs, lifts, places, coordinates |
| Search close | Close search |
| Search: online row | Search online for “{query}” · Uses OpenStreetMap (online mode) |
| Search: no hits | No matches · Try another name, coordinates or a Google Maps link |
| Search: link | Resolving Google Maps link… · Could not resolve this link |
| Search offline hint | Online search is off. Turn on online mode in Settings. |
| Menu button | Menu (aria) · title "Settings" |
| Undo / Redo | Undo · Redo |
| 3D | 3D (label) · aria: "3D terrain" + pressed state |
| Compass | Map is turned. Tap to point north. |
| Plan button | Plan route · aria-pressed. Desktop title: "Plan a route: click the map to add points (P)" / "Stop planning (P or Esc)" |
| Mode pill | Tap the map to add points (desktop: Click the map to add points · P) · ✕ "Stop planning" |
| Explore hint toast | To add points, press ✎ Plan route (P). |
| Locate states | Show my location · Finding your location · Follow my location · Follow my location and heading · Stop following · Location is off |
| Location denied | Location is off for this app. Turn it on in Settings › Privacy & Security › Location Services › Safari Websites. |
| Location error | Can't find your location right now. |
| Compass denied | Compass is off. The map can still follow your position. |
| Start from my location | Start from my location · toast after: "Start set at {name}" / "You are far from the runs. Start set at the nearest lift or run." |
| Route sheet | Route (when unsaved) · {resort} · Changed since you saved it · Share GPX · Close |
| Points | Start · Stop · Destination · Remove point {X} · Reverse · Clear |
| Empty route | Plan a route · Tap Plan route, then tap the map: first the start, then the destination. |
| One point | Now tap the map to set the destination. |
| Stats | Time · Distance · Descent · {x} km skiing · {n} lift(s) · ↑ {x} m · avg {x}% · max {x}% |
| Chip titles (desktop hover) | Average gradient of the downhill runs (descent ÷ horizontal distance) · Steepest 30 m section of the downhill runs |
| Profile | Gradient profile · Official · Steepness · Drag along the profile to see a point on the map. (desktop: Hover the profile…) |
| Legend | Green · Blue · Red · Black · Black ◆◆ · Freeride · Unknown · Lift · Path / walk · < 10% · 10–25% · 25–40% · > 40% |
| Directions | Directions · Ski {run} · Take {lift} · Ride down {lift} · Walk · Follow the ski path · Short connection · Both points are at the same spot. |
| No route | No route found · Route settings |
| Route settings | as today's planner (§3.2) |
| Saved | Saved routes · Current route · Name · Folder · Save route · Save changes · Save as new route · Name for a copy · Plan a route with a start and a destination to save it. · Saved on this iPhone only. Export a backup in Settings. · Share folder (ZIP) · Delete · Edit · Done · Route deleted · Undo · No saved routes · Routes you save appear here, grouped by folder. |
| Desktop storage | This device · Project folder |
| Map sheet | Map · Show · Ski runs · Lifts · Cross-country · Touring & sled · Run colours · Official difficulty · Steepness · Extra · Ski areas in colour · Route arrows · Route distances · Terrain · 3D terrain · Base map · Ski map (offline) · OpenSnowMap · OpenFreeMap + pistes |
| Info card | Use this spot in your route · Start here · Go here (destination) · Replace start · Set as destination · Add as stop · Add after destination |
| Menu | Settings · Resort · Online mode · Data · Routes backup · Appearance · gpx.studio · About & credits |
| Online footer | Off: everything works without internet. On: adds online maps and online search. |
| No network | No internet. Using the offline map. |
| Data | Importing data… · Checking the file… · Copying {file} · {a} of {b} MB · Checking files… · Finishing… · Cancel import · Keep the app open until the import is done. Your current data stays until the new data is ready. · Installed data · Resorts · Built on · Detail level · Space used · Free space · Protected from clean-up · iPhone can delete website data when space is low. “Protected” means the data is only deleted if you delete it. · Import data file… · Delete data · Data imported |
| Import errors | This is not a data file for this app. · This data file is from a newer app version. Reload the app and try again. · Not enough space. Free {x} MB and try again. · The file is damaged ({file}). Build it again and try again. |
| Delete confirm | Delete all map data? · Your saved routes stay. You need to import a data file again to use the app. · Delete · Cancel |
| Backup | Export backup · Import backup… · Add {n} routes from the backup? · Add · Cancel |
| Appearance | Solid interface · Shows buttons and panels without the see-through effect. Easier to read. · Keep screen on while planning · Units · Metric · Dark mode follows your iPhone setting. |
| About | Version {v} · Update available · Reload · Data sources · Always check the piste map and the conditions on the day. |
| First run | Ski route planner · Plan ski routes on your iPhone, also offline. First, add the map data. · On your computer, run `npm run build:pwa-data`. · Move the ZIP file to this iPhone with AirDrop or iCloud Drive. · Tap Import data file and pick the ZIP file. · Tip: add this app to your Home Screen first (Share › Add to Home Screen). The data is safer there. · Import data file |
| Copy buttons | Copy · Copied |

---

## 7. Icons

**Choice: Lucide** (`@lucide/svelte`, the Svelte 5 package of Lucide; ISC licence).
- Closest open set to SF Symbols: 24 px grid, 2 px round strokes, same metaphors (`share` is the iOS share box, `route`, `cable-car`, `navigation`).
- **No heavy runtime:** import each icon from its own path so only used icons are bundled:
  `import Route from '@lucide/svelte/icons/route'`. Each icon is a tiny Svelte component that renders inline SVG.
  (Alternative with zero runtime: `lucide-static` SVG strings via `?raw`; use it if bundle size matters more.)
- A thin `app/src/ui/Icon.svelte` wrapper sets the defaults: `size` 22, `strokeWidth` 2 (2.25 at ≤ 17 px, so small icons look semibold like SF), `absoluteStrokeWidth` false. Filled state: pass `fill="currentColor"` (works well for `navigation`, `bookmark`).
- Three **custom icons** in `app/src/ui/icons/` (inline SVG, same 24 grid, 2 px stroke): `location-heading` (filled navigation arrow with a short line above), `compass-needle` (the 2.7 needle), and the **app logo** (`planner/public/logo.svg` from branch `ios-app-test`).
- Add a test that imports every icon name in the table below, so a renamed icon fails the build (Lucide renames icons now and then; names checked against `lucide-static` 1.77).

| UI element | Lucide icon |
| --- | --- |
| Menu | `menu` |
| Undo / Redo | `undo-2` / `redo-2` |
| 3D | `box` |
| Compass | custom `compass-needle` |
| Plan route, mode pill | `pencil` |
| Stop planning, close sheet, clear search | `x` |
| Locate: off/centred · follow · heading · denied | `navigation` · `navigation` (filled) · custom `location-heading` · `navigation-off` |
| Start from my location | `locate-fixed` |
| Tabs: Route · Saved · Map | `route` · `bookmark` · `map` |
| Search | `search` |
| Share GPX, export, share folder | `share` |
| Remove point | `circle-x` |
| Reverse | `arrow-up-down` |
| Clear, delete | `trash-2` |
| Route settings | `sliders-horizontal` |
| Leg collapse | `chevron-down` |
| Chevron row / back | `chevron-right` / `chevron-left` |
| Checkmark | `check` |
| Open route marker in Saved | `circle-check` (filled `--green`) |
| Folder | `folder` |
| Warning / error | `triangle-alert` |
| Info / About | `info` |
| Lift step: up / down | `arrow-up` / `arrow-down` (search result & info card: `cable-car`) |
| Walk / ski path step | `footprints` |
| Run (search result, info card) | `mountain-snow` in a piste-coloured tile |
| Place / peak | `mountain-snow` (grey tile) · village `house` |
| Coordinates · Google Maps link | `crosshair` · `map-pin` |
| Resort | `mountain-snow` |
| Online mode · no network | `globe` · `wifi-off` |
| Data, import | `hard-drive` · `file-down` |
| Routes backup | `archive` |
| Appearance | `sun-moon` |
| gpx.studio · Copy | `link` · `copy` |
| Zoom in / out (desktop) | `plus` / `minus` |
| Hide/show panel (desktop) | `panel-left` |
| Time · distance · ascent · descent (optional chip icons) | `clock` · `move-horizontal` · `trending-up` · `trending-down` |

---

## 8. Decisions taken in this spec (details in `docs/agents/decisions.md`)

- System blue is the only accent; run colours never style UI chrome.
- Medium sheet floats above the tab bar (glass); large sheet is solid and the tab bar floats over it with a fade.
- Undo/redo share one capsule, hidden when empty; compass under the 3D capsule; mode pill avoids the compass column.
- Glass budget expressed as area (≤ 30 %) + count (≤ 6 normal, ≤ 9 peak) instead of "3–5" (small buttons are cheap).
- Chart readout replaces the chart header instead of a floating bubble.
- iPhone: tap on a route marker opens it in the Route sheet (does not remove it). Desktop keeps click-to-remove.
- Search results never add points directly; they open the info card with its actions (as the current web planner).
- Landscape phone uses the desktop arrangement (left panel with a segmented header).
- Map style stays light in dark mode.
- Icons: Lucide with per-icon imports.

No open question needs the owner right now. Things to verify on the real iPhone in phase 7: blur cost while panning
(§5.5), `-apple-system-body` Dynamic Type scaling in standalone mode, the keyboard positioning of the search field.
