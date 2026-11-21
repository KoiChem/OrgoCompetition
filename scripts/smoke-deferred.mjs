// Smoke: mate room with まとめて判定 (deferred) through the real UI.
// Usage: node scripts/smoke-deferred.mjs [baseUrl]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8793';
const executablePath = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const log = (...a) => console.log(...a);
try {
  const host = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await host.goto(base, { waitUntil: 'networkidle' });
  await host.getByRole('link', { name: 'メイトマッチ' }).click();
  await host.getByLabel(/あなたのニックネーム/).fill('まとめホスト');
  await host.getByRole('button', { name: 'まとめて判定' }).click();
  await host.getByRole('button', { name: '5問', exact: true }).click();
  log('SUMMARY before create:', await host.locator('.settings-summary').textContent());
  await host.getByRole('button', { name: 'メイトマッチを作成' }).click();
  await host.locator('.room-code').waitFor({ timeout: 10000 });
  const code = (await host.locator('.room-code').textContent()).trim();
  log('ROOM code:', code, '| settings line:', await host.locator('.settings-line').first().textContent());

  const guest = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await guest.addInitScript(() => {
    window.__sentFrames = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { const m = JSON.parse(String(data)); if (m.type === 'draft' || m.type === 'submit') window.__sentFrames.push({ type: m.type, answers: Array.isArray(m.answers) ? m.answers.length : 0 }); } catch {}
      return orig.call(this, data);
    };
  });
  await guest.goto(base, { waitUntil: 'networkidle' });
  await guest.getByLabel('参加コード').fill(code);
  await guest.getByRole('button', { name: '参加する' }).click();
  await guest.getByLabel(/ニックネーム/).waitFor({ timeout: 10000 });
  await guest.getByLabel(/ニックネーム/).fill('まとめゲスト');
  await guest.getByRole('button', { name: '参加する' }).click();
  await guest.locator('.participant-list li').first().waitFor({ timeout: 10000 });
  await host.locator('.participant-list li').nth(1).waitFor({ timeout: 10000 });
  await host.getByRole('button', { name: '開始する' }).click();

  // Deferred player: answer ALL 5 questions rapidly, then submit immediately.
  // Flush contract: a draft frame carrying all 5 answers must precede submit.
  await guest.locator('.answer-choice').first().waitFor({ timeout: 20000 });
  log('GUEST deferred progress:', await guest.locator('.question-progress').textContent());
  for (let i = 0; i < 5; i++) {
    await guest.locator('.answer-choice').first().click();
    if (i < 4) await guest.getByRole('button', { name: '次の問題' }).click();
  }
  log('GUEST after rapid answering:', await guest.locator('.question-progress').textContent());
  await guest.getByRole('button', { name: '提出する' }).click();
  await guest.getByText('提出済み').first().waitFor({ timeout: 10000 });
  log('GUEST submitted state shown: OK');
  const sentFrames = await guest.evaluate(() => window.__sentFrames);
  const submitIdx = sentFrames.findIndex(f => f.type === 'submit');
  const fullDraftBeforeSubmit = submitIdx > 0 && sentFrames.slice(0, submitIdx).some(f => f.type === 'draft' && f.answers === 5);
  log('WS frames:', JSON.stringify(sentFrames));
  if (!fullDraftBeforeSubmit) throw new Error('flush contract violated: no full draft (5 answers) before submit');
  log('FLUSH CONTRACT OK: full draft preceded submit');
  await guest.screenshot({ path: 'smoke/05-deferred-submitted.png', fullPage: true });
  log('SMOKE DEFERRED OK');
} finally {
  await browser.close();
}
