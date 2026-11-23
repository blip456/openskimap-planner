# iPhone test, phase 6 (location, compass, start from my location, screen on)

Some things only a real iPhone can show: the location and compass questions of iOS, how "follow with heading"
feels, and if the screen stays on. It takes about 20 minutes. Best done **outside**, near a road or a run, so the
GPS works well. Write down what you see at each step (OK, or what went wrong, with a screenshot if you can).

## What you need

- The app with HTTPS (location only works on https): a Vercel preview link of the branch `iphone-pwa`, or on the Mac
  `npm run build:pwa` and `npm run dev:pwa -- --preview --phone` (see the README section "Testing on the iPhone").
- The app installed on the Home Screen and the data imported (see `iphone-test-phase5.md`).
- For step 4 you need to be at the ski resort of your data, or at least within 400 m of a run or lift. If you are
  not, do step 4b only.

## 1. My location (first time)

1. Open the app from the Home Screen. Tap the **arrow button** at the bottom right.
2. Check: iOS asks "Allow "Ski planner" to use your location?". Tap **Allow While Using App** (or Allow Once).
3. Check: the arrow turns blue and pulses for a short moment, then a **blue dot** with a white ring appears, and the
   map moves to it. With a weak signal a light blue circle around the dot shows how exact the position is.
4. Walk a few metres. Check: the dot moves. The map does not move (not following yet).

## 2. Follow modes (like Apple Maps)

1. Tap the arrow button again. Check: the arrow is **filled** blue. Walk: the map now moves with you.
2. Move the map with one finger. Check: the arrow is no longer filled; the map stops following.
3. Tap the arrow again (filled), then once more. Check: iOS asks to use "motion and orientation" (only the first
   time). Tap **Allow**.
4. Check: the button shows an arrow with a small line above it, a light blue **cone** shows on the dot, and the map
   **turns with you** when you turn around. Turn slowly in a full circle, also through north.
   - Does it feel smooth? Does it shake when you stand still? Does it ever spin the long way round?
   - Write down how it feels (fine / too slow / too nervous).
5. Turn the map with two fingers. Check: the map stops turning with you, but still follows (filled arrow).
6. Tap the arrow until it shows "Stop following" and tap once more. Check: the map turns back to north. The dot stays.
7. Turn the map with two fingers, then tap the **compass** (top right). Check: the map points north again.

## 3. Hidden app: no GPS in the background

1. With the dot shown, go to the Home Screen for 1 minute (or lock the iPhone).
2. Check: the location arrow in the iPhone status bar goes away while the app is hidden (Control Center or the
   status bar shows it).
3. Open the app again. Check: the dot comes back within a few seconds.

## 4. Start from my location (at the resort)

1. In the tab bar tap **Route**. Check: "Plan a route" with a blue button **Start from my location**.
2. Tap it. Check: point **A** appears on the nearest run or lift, and a message "Start set at …" (or "You are far
   from the runs …" when you are 75–400 m away).
3. Tap **Plan route** and tap a destination on the map. Check: a route from your position.
4. Walk somewhere else and tap **My location** (next to Reverse). Check: the new start is now A, and the old A is
   now B (or A is replaced when you did not move).

### 4b. Start from my location (far from the resort)

1. Tap **Start from my location**. Check: the message "You are … km from the nearest run or lift. Start from my
   location works in the ski area." Nothing is added.

## 5. Location turned off

1. iPhone **Settings › Privacy & Security › Location Services › Safari Websites** (or the app's own entry if there is
   one): set it to **Never**.
2. Open the app and tap the arrow button. Check: the button shows a crossed-out arrow, and a message says
   "Location is off for this app. Turn it on in Settings › …". The rest of the app still works.
3. Set it back to **While Using the App**.

## 6. Keep the screen on

1. Menu (≡) › **Appearance**. Check: the switch **Keep screen on while planning** is there. (If it is missing, your
   iOS version does not support it; write down the iOS version.)
2. Turn it on. Close the menu and do not touch the iPhone for longer than your Auto-Lock time
   (Settings › Display & Brightness › Auto-Lock). Check: the screen stays on.
3. Go to the Home Screen and back, wait again. Check: it still stays on.
4. Turn the switch off. Check: the screen turns off as usual.

## 7. Touch and share

1. Pinch with two fingers on the buttons, the sheet and the menu. Check: the **page never zooms** (only the map zooms).
2. On the map: pinch to zoom, twist with two fingers to turn, drag two fingers up/down to tilt. Check: all work.
3. Double-tap a button quickly. Check: the page does not zoom.
4. Route sheet › **Share GPX**. Check: the iOS share sheet shows a `.gpx` file (Save to Files, AirDrop).
5. Menu › **Routes backup** › **Export backup** (save a route first). Check: the share sheet shows a `.json` file.
   If a file downloads instead of the share sheet, write it down.

## What to send back

- For each step: OK, or what went wrong.
- iOS version and iPhone model.
- How "follow with heading" feels (step 2.4).
