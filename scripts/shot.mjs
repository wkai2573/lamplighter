// Usage: bun scripts/shot.mjs "<query>" out.png [waitMs] [width] [height] [evalJs]
import puppeteer from 'puppeteer-core';

const [, , query = '', out = 'shot.png', wait = '2500', w = '1280', h = '720', evalJs = ''] = process.argv;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: +w, height: +h },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${process.env.BASE || 'http://localhost:8000/'}${query}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 60000 }).catch(() => logs.push('[timeout] __ready not set'));
if (evalJs) await page.evaluate(evalJs);
await new Promise((r) => setTimeout(r, +wait));
const info = await page.evaluate(() => (window.__info ? window.__info() : null)).catch(() => null);
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
if (info) console.log('info:', JSON.stringify(info));
await browser.close();
