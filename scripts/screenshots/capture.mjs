// Capture the documentation screenshots from a running, demo-seeded instance.
//
// Usage: node scripts/screenshots/capture.mjs http://127.0.0.1:8790 docs/images
// Needs Playwright (npm i -g playwright, or NODE_PATH pointing at it).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] || 'http://127.0.0.1:8790').replace(/\/$/, '');
const out = process.argv[3] || 'docs/images';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

async function session(viewport, scale = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark' });
  // Service worker caching would only get in the way of a fresh capture
  await ctx.route('**/sw.js', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  return page;
}

async function go(page, hash, wait = '#main > *:not(.spinner)') {
  await page.goto(`${base}/#/${hash}`);
  await page.waitForSelector(wait);
  await page.waitForTimeout(600); // fade-in animation
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}

// ---- Desktop ----
const desk = await session({ width: 1440, height: 900 });

await go(desk, 'dashboard', '.stat-grid');
await shot(desk, 'dashboard');

await go(desk, 'inventory', '.item-row');
await shot(desk, 'inventory');

await desk.locator('.item-row', { hasText: 'Heat-Set Inserts' }).click();
await desk.waitForSelector('.modal');
await desk.waitForTimeout(500);
await shot(desk, 'item-detail');

await go(desk, 'inventory?category=filament', '.item-row');
await shot(desk, 'inventory-filament');

await go(desk, 'locations', '.loc-row');
const expand = (name) => desk.locator('.loc-row', { hasText: name }).first()
  .locator('.loc-toggle').click();
await expand('Garage Workshop');
await expand('Closet Rack');
await expand('Shelf 1');
await desk.locator('.loc-row', { hasText: 'Nuts & Inserts Bin' }).first().click();
await desk.waitForTimeout(500);
await shot(desk, 'locations');

await go(desk, 'printers', '.card');
await shot(desk, 'printers');

await go(desk, 'labels', '.template-card');
await desk.waitForTimeout(400); // canvas previews
await shot(desk, 'labels-gallery');
await desk.locator('.template-card', { hasText: 'Storage Box' }).locator('button', { hasText: 'Edit' }).click();
await desk.waitForTimeout(800);
await shot(desk, 'labels-designer');

await go(desk, 'reports', '.card');
await shot(desk, 'reports');

await go(desk, 'import');
await shot(desk, 'import');

await go(desk, 'bom');
await shot(desk, 'bom');

await go(desk, 'activity', '.activity-row');
await shot(desk, 'activity');

await go(desk, 'duplicates');
await shot(desk, 'duplicates');

await go(desk, 'settings', '.card');
await shot(desk, 'settings');

// ---- Phone (iPhone-sized) ----
const phone = await session({ width: 402, height: 874 }, 3);
await go(phone, 'dashboard', '.stat-grid');
await shot(phone, 'phone-dashboard');
await go(phone, 'inventory', '.item-row');
await shot(phone, 'phone-inventory');
await go(phone, 'scanner');
await shot(phone, 'phone-scanner');

await browser.close();
