# iPhone test, phase 7 (look and feel, dark mode, accessibility, landscape)

This is the **owner review** of the final design. It takes about 20 minutes and works at home (no GPS needed).
Write down what you see at each step: OK, or what looks wrong (a screenshot helps a lot).

## What you need

- The app from the branch `iphone-pwa` on HTTPS: a Vercel preview link, or on the Mac
  `npm run preview:pwa -- --phone` (see the README section "Testing on the iPhone").
- The app on the Home Screen, with the data imported (see `iphone-test-phase5.md`).
- For comparison: the screenshots in `docs/agents/screenshots/phase7/` and the mockups in `docs/design/mockups/`.

## 1. Glass look (light mode)

1. Open the app. Plan a route with 3 points (tap **Plan route**, tap the map 3 times).
2. Check the buttons on the map (menu, 3D, Plan route, location arrow, tab bar, search): you see the map softly
   **blurred** through them, with a thin light edge and a soft shadow.
3. Check the Route sheet at half height: the map shows blurred through the sheet around the white cells.
4. Is all text easy to read, also over white snow and over dark forest? Pan the map under the buttons to test.
5. Compare with `route-sheet-medium.png` in the mockups. Anything that looks clearly different?

## 2. Smoothness

1. With the Route sheet at half height, pan and zoom the map quickly for 10 seconds.
   - Does it feel smooth, or does it stutter?
2. Menu › Appearance › turn on **Solid interface**. Pan again the same way.
   - Is it smoother than with glass? A little, a lot, or the same?
3. Turn **Solid interface** off again.
4. Drag the sheet up and down a few times, and open/close the tabs. Does the sheet movement feel smooth and "springy"?

## 3. Dark mode

1. iPhone Settings › Display & Brightness › **Dark**. Go back to the app.
2. Check: buttons, tab bar, sheets, menu and search are dark. The **map itself stays light** (on purpose: there is
   no dark map style).
3. Is all text easy to read? Check the Route sheet (half and full height), the Map tab, the menu and a search.
4. Switch back to Light (or Automatic) when done.

## 4. Accessibility settings

1. Settings › Accessibility › Display & Text Size › **Reduce Transparency** on. Open the app.
   - Note: Safari may not tell the app about this setting. If the buttons still look see-through, that is
     expected; then use Menu › Appearance › **Solid interface** instead. Write down which one you saw.
2. Settings › Accessibility › Display & Text Size › **Increase Contrast** on. Open the app.
   - Check: the buttons and sheet are almost not see-through, with a clear border.
3. Settings › Accessibility › Motion › **Reduce Motion** on. Open the app.
   - Check: sheets fade in and out instead of sliding; tapping 3D or a search result jumps the map instead of
     flying.
4. Settings › Accessibility › Display & Text Size › **Larger Text**: move the slider two steps to the right.
   - Check: the text in the sheets and the menu gets bigger; the map buttons stay the same size. Nothing is cut off?
5. Turn all four settings back off.

## 5. Landscape

1. Turn off the rotation lock (Control Center). Turn the iPhone on its side.
2. Check: the panel is on the left (search field, menu button, Route · Saved · Map on top). There is no tab bar at the
   bottom. Undo and 3D are at the top right, Plan route at the bottom left of the map, the location arrow at the
   bottom right. Nothing is hidden behind the notch / Dynamic Island.
3. Tap a run (Plan route off): its card shows in the panel. Tap **Route** in the panel: the route is back.
4. Tap the panel button (square icon next to Plan route): the panel hides and the map uses the full width. Tap again.
5. Turn back to portrait. Check: the normal layout comes back and your route is still there.

## 6. Keyboard and search position

1. Tap the **search** button. Check: the search field sits right above the keyboard, the results above it.
2. Type a lift name, pick a result, then close the keyboard. Check: the page did not move up or leave a gap at the
   bottom (a known iOS 26 problem).

## What to send back

For each section: OK, or what you saw. Also the answers to: "smoother with Solid interface?" (2.2) and "which
setting made the buttons solid?" (4.1).
