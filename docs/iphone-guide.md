# iPhone guide

This guide is for using the ski route planner on your iPhone. You need iOS 16.4 or newer.

The app has two parts:

- **The app.** You open it from a web address and add it to the Home Screen.
- **The map data.** One ZIP file that you make on your computer and move to the iPhone. The data stays on the phone.
  After that the app works without internet, also on the slope.

## 1. Install the app on the Home Screen

1. Open the web address of the app in **Safari**. (Other browsers cannot add apps to the Home Screen on iPhone.)
2. Tap the **Share** button (the square with the arrow).
3. Tap **Add to Home Screen**, then **Add**.
4. Open the app from the new icon "Ski planner". It opens full screen, without the Safari address bar.

Always open the app from the Home Screen icon. Safari and the Home Screen app keep their data apart. Data imported in
Safari is not in the Home Screen app.

## 2. Make the data file (on your computer)

```sh
npm run build:pwa-data         # normal size (about 46 MB for Oberstdorf)
npm run build:pwa-data z12     # smaller (about 12.5 MB), less sharp terrain
```

You get `build/pwa/openskimap-data-YYYY-MM-DD-z14.zip`. Do not unzip it.

## 3. Move the ZIP to the iPhone

Choose one way:

- **AirDrop:** on the Mac, right-click the ZIP › Share › AirDrop › your iPhone. On the iPhone tap Accept. The file is
  in the **Files** app, in **Downloads**.
- **iCloud Drive:** copy the ZIP to a folder in iCloud Drive on the Mac. On the iPhone open Files › iCloud Drive and
  wait until the file is downloaded (no cloud icon next to it).

## 4. Import the data

1. Open the app from the Home Screen. On the first start you see three steps and a blue **Import data file** button.
2. Tap **Import data file** and pick the ZIP in Files.
3. Wait. A progress bar shows how much is copied. The app checks every file.
4. The map appears with runs and lifts. A short message says "Data imported".

If something is wrong, you get a message and your old data stays as it was.

## 5. What "Keep data" means

Open **Menu (≡) › Data**. The row **Keep data** says:

- **On:** the browser promised to keep the data. It is only removed when you delete it or remove the app.
- **Off:** iOS may delete the data if the iPhone runs low on space. Then import the file again. Tap **Ask to keep the
  data** to try again. Data of an app opened from the Home Screen is kept much better than data in Safari.
- **Unknown:** the browser does not say.

Keep the ZIP file in Files or iCloud Drive, so you can import it again at any time.

## 6. Online mode

**Menu › Online mode.** The default is **off**. Everything works without internet.

When you turn it on, you get more maps (OpenSnowMap, OpenFreeMap with your runs and lifts) and the *Search online*
line in the search. Without a network the app says so and uses the offline map. Turn it off to save mobile data.

## 7. Location and compass

Tap the **arrow button** at the bottom right.

1. iOS asks to use your location. Tap **Allow While Using App**.
2. The blue dot shows where you are. Tap the arrow again to follow you. Tap again to follow and turn the map with the
   compass. iOS asks once for motion and orientation. Tap **Allow**.
3. The app only uses the GPS while it is open on screen.
4. To start a route where you stand, open the **Route** tab and tap **Start from my location**. This works within
   about 400 m of a run or lift.

If the app says location is off or "denied":

1. Open the iPhone **Settings › Privacy & Security › Location Services**. Make sure Location Services is on.
2. Scroll to **Safari Websites** (the entry for web apps) and choose **While Using the App**.
3. For the compass: **Settings › Privacy & Security › Motion & Fitness**, and check that it is allowed. If iOS never
   asks again, close the app fully and open it again.
4. Go back to the app and tap the arrow again.

The rest of the app works without location.

## 8. Share a route as GPX

1. Plan a route.
2. In the **Route** tab tap the **share** button (**Share GPX**).
3. Pick where to send it: Save to Files, AirDrop, Mail, and so on.
4. Open the `.gpx` file in gpx.studio with *File › Open*.

Your saved routes are kept in the browser, not in the data. To keep a copy, use **Menu › Routes backup › Export
backup**.

## 9. Update the app

The app updates itself when you are online.

1. Open the app and wait a few seconds.
2. When you see **New version available**, tap **Reload**.
3. The version number is in **Menu › About & credits**.

If no message comes, swipe the app away (close it fully) and open it again while online.

Updating the app does not change your map data or saved routes.

## 10. Update the data

1. On your computer run `npm run build` (gets new OpenSkiData) and `npm run build:pwa-data`.
2. Move the new ZIP to the iPhone (step 3).
3. In the app: **Menu › Data › Import new data file…**, and pick the new ZIP.

The new data replaces the old one only when the whole import worked.

## Troubleshooting

**The data is gone.**
- You may have opened Safari instead of the Home Screen app. Open the Home Screen icon.
- iOS may have deleted the data when the phone was low on space (see "Keep data"). Import the ZIP again.
- Clearing Safari website data deletes it too.

**The import fails.**
- *Wrong file:* pick the `openskimap-data-….zip` file. Do not unzip it, and do not pick a different ZIP.
- *The file is damaged:* the copy to the iPhone was not complete. Move the file again. For iCloud Drive wait until it
  is fully downloaded.
- *Not enough space:* free some space on the iPhone (Settings › General › iPhone Storage), or make a smaller ZIP
  with `npm run build:pwa-data z12`.
- Try again. Your old data is still there.

**The map is blank.**
- Check that data is imported: Menu › Data should show a resort. If not, import the ZIP.
- Zoom out and look for your resort. The map only has the resorts in the data.
- If you chose an online map and have no network, switch **Online mode** off.
- Close the app fully and open it again. If it still is blank, import the ZIP again.

**Location does not work.**
- See "Location and compass" above, and check the iOS settings.
- Use the app from the Home Screen over HTTPS. Location does not work on plain `http` addresses.
- The GPS is weaker inside buildings. Go outside and wait a moment.

## Testing

For the people who build the app. Some things only a real iPhone can show. These checklists list them:

- `docs/agents/iphone-test-phase5.md`: install, import, offline start, update.
- `docs/agents/iphone-test-phase6.md`: location, compass, start from my location, keep screen on, share.
- `docs/agents/iphone-test-phase7.md`: design, landscape, dark mode, accessibility, speed.
