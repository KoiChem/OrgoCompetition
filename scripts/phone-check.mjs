import { chromium } from 'playwright-core';
const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe });
for (const [name, w, h] of [['iphone390x844', 390, 844], ['se667', 375, 667]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:8793/', { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, bodyScroll: document.body.scrollHeight }));
  const qr = await page.locator('.qr-button').count();
  const nav = await page.locator('.home-nav .secondary-link').allInnerTexts();
  console.log(name, JSON.stringify(m), 'qrButtons:', qr, 'nav:', nav.join(' / '));
  await page.screenshot({ path: `smoke/home-${name}.png` });
  await page.close();
}
await browser.close();
