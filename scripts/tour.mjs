// Usage: bun scripts/tour.mjs "x1,x2,..." [prefix] [wait] [extraQuery] [evalBeforeEach]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });

const [, , xs = '10', prefix = 'tour', wait = '1500', extra = '', pre = ''] = process.argv;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:8000/?skip${extra}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
for (const x of xs.split(',')) {
  await page.evaluate((x, pre) => {
    const g = window.__game;
    g.placePlayer(+x);
    g.ui.clearNarration();
    if (pre) eval(pre);
  }, +x, pre);
  await new Promise((r) => setTimeout(r, +wait));
  await page.screenshot({ path: `shots/${prefix}_${x}.png` });
  const info = await page.evaluate(() => window.__info());
  console.log(x, JSON.stringify(info));
}
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
