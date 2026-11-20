// Renders the mockups to PNG: node docs/design/mockups/render.cjs
// Also inlines icons-sprite.html (Lucide symbols) into each mockup between <!--SPRITE--> and <!--/SPRITE-->.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = __dirname;
const sprite = fs.readFileSync(path.join(dir, 'icons-sprite.html'), 'utf8').trim();
const pages = {
  'main-iphone.html': [['main', 'main-iphone'], ['search', 'search-iphone']],
  ...(fs.existsSync(path.join(dir,'sheets-iphone.html'))?{'sheets-iphone.html': [['route-medium', 'route-sheet-medium'], ['route-large', 'route-sheet-large'], ['map-sheet', 'map-sheet'],
    ['menu', 'menu'], ['menu-data', 'menu-data'], ['onboarding', 'onboarding']]}:{}),
};

(async () => {
  const browser = await chromium.launch();
  for (const [file, frames] of Object.entries(pages)) {
    const p = path.join(dir, file);
    const html = fs.readFileSync(p, 'utf8');
    const next = /<!--\/SPRITE-->/.test(html) ? html.replace(/<!--SPRITE-->[\s\S]*?<!--\/SPRITE-->/, () => sprite) : html.replace('<!--SPRITE-->', () => sprite);
    fs.writeFileSync(p, next);
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('file://' + p);
      await page.waitForTimeout(150);
      for (const [id, out] of frames) {
        await page.locator('#' + id).screenshot({ path: path.join(dir, `${out}${scheme === 'dark' ? '-dark' : ''}.png`) });
      }
      await ctx.close();
    }
  }
  await browser.close();
})();
