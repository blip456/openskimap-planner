# Host the iPhone app on Vercel

Vercel serves the iPhone app (the PWA) as a static website. The iPhone needs HTTPS for the Home Screen app, the
service worker, storage and location. Vercel gives you HTTPS for free.

**The map data is not hosted.** Vercel only has the app (about 2 MB). The data ZIP stays on your computer. You move it
to the iPhone yourself (see `docs/iphone-guide.md`).

## Set up

1. Sign in at <https://vercel.com> (a free Hobby account is enough). Use "Continue with GitHub".
2. Click **Add New › Project**. Pick the GitHub repository `openskimap-planner` (give Vercel access to it if asked).
3. **Production Branch:** at the moment the work is on the branch `iphone-pwa`. Open the project's **Settings › Git**
   and set the Production Branch to `iphone-pwa`. When the work is merged, set it to `main`.
4. Leave the build settings alone. They come from `vercel.json` in the repository:

   | Setting | Value |
   | --- | --- |
   | Framework | none |
   | Install command | `npm ci --ignore-scripts` |
   | Build command | `npm run build:pwa` |
   | Output directory | `app/dist` |

   Vercel may show other values in the form. The values in `vercel.json` win. Do not change them in the dashboard.
5. **Environment variables:** none. Leave the list empty.
6. Click **Deploy**. After about one minute you get a link like `https://openskimap-planner.vercel.app`.

There are no serverless functions. Only static files are served.

## Preview deploys

Every push to any other branch, and every pull request, gets its own preview link with HTTPS. Find it in the
**Deployments** tab, or in the pull request. You can add the preview to the Home Screen and test it on the iPhone.
Each link is its own website, so it has its own storage: you must import the data ZIP again for each one.

## Custom domain (optional)

1. **Settings › Domains › Add**, type your domain, and follow the DNS steps Vercel shows.
2. Use the same domain every time. Home Screen apps and imported data belong to one web address. If the address
   changes, the iPhone sees a new app and the data must be imported again.

## Check that updates work after a deploy

The app updates through its service worker. `vercel.json` makes sure the files that must be fresh (`sw.js`,
`index.html`, the manifest) are never cached, and the hashed files in `assets/` are cached for a year.

After a deploy:

1. Open the site in a desktop browser. In Chrome open DevTools › Application › Service workers.
2. Check that `sw.js` is listed and its status is "activated".
3. Check the headers of `/sw.js` in DevTools › Network: `Cache-Control: no-cache`.
4. Deploy a small change. Open the installed app on the iPhone (or reload the site) and wait a few seconds.
5. The app shows **New version available**. Tap **Reload**. The new version starts. The version number is under
   Menu › About & credits.

If no prompt comes, close the app fully (swipe it away) and open it again. See "Update the app" in
`docs/iphone-guide.md`.

## Check locally before you push

```sh
npm run build:pwa      # same command as Vercel
npm run preview:pwa    # serve it with the service worker on http://localhost:4174
```
