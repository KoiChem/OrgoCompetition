// Headless UI smoke test against the local wrangler dev server.
// Usage: node scripts/smoke-ui.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8793';
const outDir = process.argv[3] ?? 'smoke';
mkdirSync(outDir, { recursive: true });
const executablePath = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const log = (...a) => console.log(...a);
try {
  const host = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await host.goto(base, { waitUntil: 'networkidle' });
  log('HOME title:', await host.title());
  log('HOME h1:', await host.locator('h1').first().textContent());
  await host.screenshot({ path: `${outDir}/01-home.png` });

  // Mate create: nickname + create (defaults: four-choice, 10 questions)
  await host.getByLabel('あなたのニックネーム').fill('テスト太郎');
  await host.getByRole('button', { name: 'メイトマッチを作成' }).click();
  await host.locator('.room-code').waitFor({ timeout: 10000 });
  const code = (await host.locator('.room-code').textContent()).trim();
  log('ROOM code:', code);
  await host.screenshot({ path: `${outDir}/02-lobby-host.png` });

  const guest = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await guest.goto(base, { waitUntil: 'networkidle' });
  await guest.getByLabel('参加コード').fill(code);
  await guest.getByRole('textbox', { name: 'ニックネーム', exact: true }).fill('テスト花子');
  await guest.getByRole('button', { name: '参加する' }).click();
  await guest.locator('.participant-list li').first().waitFor({ timeout: 10000 });
  log('GUEST lobby participants:', await guest.locator('.participant-list li').count());

  await host.locator('.participant-list li').nth(1).waitFor({ timeout: 10000 });
  log('HOST lobby participants:', await host.locator('.participant-list li').count());
  await host.getByRole('button', { name: '開始する' }).click();
  guest.on('console', m => log('GUEST console:', m.type(), m.text()));
  guest.on('pageerror', e => log('GUEST pageerror:', e.message));
  try { await guest.locator('.answer-choice').first().waitFor({ timeout: 20000 }); }
  catch (e) { log('GUEST body:', (await guest.locator('body').innerText()).slice(0, 800)); log('HOST body:', (await host.locator('body').innerText()).slice(0, 400)); throw e; }
  log('GUEST question progress:', await guest.locator('.question-progress').textContent());
  log('GUEST prompt label:', await guest.locator('.prompt-label, .prompt-name').first().textContent());
  log('GUEST choices:', await guest.locator('.answer-choice').count());
  await guest.screenshot({ path: `${outDir}/03-question.png`, fullPage: true });
  await guest.locator('.answer-choice').first().click();
  await guest.waitForTimeout(1200);
  log('GUEST verdict:', (await guest.locator('.verdict').count()) ? await guest.locator('.verdict').textContent() : '(none)');
  log('GUEST progress after answer:', await guest.locator('.question-progress').textContent());
  await guest.screenshot({ path: `${outDir}/04-after-answer.png`, fullPage: true });
  log('SMOKE OK');
} finally {
  await browser.close();
}
