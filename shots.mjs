import { chromium } from '@playwright/test';

const shots = [
  { name: 'landing-desktop.png', viewport: { width: 1440, height: 900 }, url: 'http://127.0.0.1:5179/' },
  { name: 'landing-mobile.png', viewport: { width: 390, height: 844 }, url: 'http://127.0.0.1:5179/' },
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: s.name, fullPage: false });
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    imgs: Array.from(document.querySelectorAll('img')).map((i) => ({ src: i.getAttribute('src'), natural: i.naturalWidth })),
  }));
  console.log(s.name, JSON.stringify(overflow));
  await ctx.close();
}
await browser.close();
