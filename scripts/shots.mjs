import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:5175';
const OUT = process.env.SHOT_OUT ?? '.supergoal/shots';
mkdirSync(OUT, { recursive: true });

const widths = { desktop: 1440, tablet: 834, mobile: 390 };

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log('shot', name);
}

async function login(page) {
  const email = page.locator('input[type="email"]').first();
  if (await email.count()) {
    await email.fill('mira@example.com');
    await page.locator('input[type="password"]').first().fill('password123');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  }
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: widths.desktop, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-01-login');

  // login
  await login(page);
  await shot(page, 'desktop-02-manuscript');

  // reader mode
  await page.goto(`${BASE}/manuscript/books?mode=read`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-03-reader');

  // draft mode
  await page.goto(`${BASE}/manuscript/books?mode=draft`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-04-draft');

  // chat
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-05-chat');

  // chat with reader open
  await page.goto(`${BASE}/chat?reader=open`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-06-chat-reader');

  // mobile manuscript
  const m = await browser.newContext({ viewport: { width: widths.mobile, height: 844 } });
  const mp = await m.newPage();
  await mp.goto(BASE, { waitUntil: 'networkidle' });
  await login(mp);
  await shot(mp, 'mobile-02-manuscript');
} finally {
  await browser.close();
}
