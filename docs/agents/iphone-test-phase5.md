# iPhone test, phase 5 (install, import, offline)

This is the review moment for phase 5. It takes about 20 minutes. Write down what you see at each step (OK, or what
went wrong, with a screenshot if you can).

## What you need

- The app online with HTTPS. Either:
  - a Vercel preview link of the branch `iphone-pwa` (easiest), or
  - on your Mac: `npm run preview:pwa -- --phone` (needs mkcert, see the README section "Testing on the iPhone").
    Note: this is the first real test of `--phone`; it could not be tried in the cloud environment.
- The data file: on the Mac run `npm run build:pwa-data`. You get `build/pwa/openskimap-data-….zip`.
- iOS 17 or newer (the app needs iOS 16.4 at least).

## 1. Install to the Home Screen

1. Open the link in **Safari** on the iPhone.
2. You see the start screen "Ski route planner" with 3 steps and a blue **Import data file** button.
3. Tap the Share button › **Add to Home Screen** › Add.
4. Check: the icon is the yeti on a dark background, with no white border. The name under it is "Ski planner".
5. Open the app from the Home Screen. Check: it opens full screen, with no Safari address bar.

## 2. Import the ZIP via Files

1. On the Mac, AirDrop the ZIP file to the iPhone. It goes to Files › Downloads. (Or put it in iCloud Drive.)
2. In the app (opened from the Home Screen), tap **Import data file** and pick the ZIP. Do not unzip it first.
3. Check: a progress bar shows "Copying … MB of … MB". Note how long it takes.
4. Check: the map appears, with runs and lifts. A short message "Data imported" shows.

## 3. Airplane mode

1. Close the app fully (swipe it up in the app switcher).
2. Turn on **Airplane mode** (also turn off Wi-Fi).
3. Open the app from the Home Screen again.
4. Check: the app starts and the map shows (no "no internet" page from Safari).
5. **Route:** tap **Plan route**, tap two points on runs. Check: a route appears with time and distance.
6. **Search:** tap the search button, type the name of a lift. Check: it is found and the map shows it.
   Type a word that does not exist. Check: a note says why there is no online search.
7. **Menu › Online mode:** turn it on. Check: the menu shows "No internet" in orange, and the map stays the
   offline map. Turn it off again.
8. Turn Airplane mode off.

## 4. Storage screen

1. Tap ≡ (menu) › **Data**.
2. Check "Installed data": resort name, "Built on" date, "Detail level".
3. Check "Size": base map, terrain, runs and lifts, … and a total (about 46 MB for the zoom 14 file).
4. Check "Storage on this device": "Used by this app" with a bar, and "Available".
5. Check **Keep data**: "On" (green) or "Off" (orange). Please write down which one you see, once in Safari and
   once in the Home Screen app. If it is "Off", tap **Ask to keep the data** and write down what happens.

## 5. Delete and import again

1. In Menu › Data, tap **Delete data**. A question appears. Tap **Cancel**. Check: nothing changed.
2. Tap **Delete data** again, then **Delete**. Check: the start screen with the 3 steps appears, and
   "Data deleted" shows.
3. Close the app and open it again. Check: still the start screen (the data is really gone).
4. Import the ZIP again (step 2). Check: the map is back. Your saved routes are still in the Saved tab.

## 6. Errors (optional, 2 minutes)

1. Delete the data again. Tap **Import data file** and pick another ZIP file that is not the data file (only ZIP
   files can be picked). Check: a box "Wrong file" with a short explanation.
2. Import the right ZIP again.

## 7. Update prompt (optional, only with a Vercel link)

1. After a new push to the branch, open the app (from the Home Screen) and wait a moment, or switch to another
   app and back.
2. Check: a small bar "New version available · Reload" shows at the top. Nothing reloads by itself.
3. Tap **Reload**. Check: the app reloads and your route is still there.

## What to send back

- For each step: OK, or what went wrong.
- The import time and the "Keep data" value (Safari and Home Screen app).
- Anything that looks wrong or is hard to understand.
