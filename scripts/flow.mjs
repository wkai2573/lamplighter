// Drives the real UI with key presses and captures screenshots along the way.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `shots/flow_${name}.png` });
  const info = await page.evaluate(() => window.__info && window.__info());
  console.log(name, JSON.stringify(info));
};
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await sleep(2500);
await shot('1_title');
await page.keyboard.press('Enter');
await sleep(2200);
await shot('2_intro');
await sleep(3000);
await shot('3_play');
// walk right to the first stone lantern, jumping over the log
await page.keyboard.down('KeyD');
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const x = await page.evaluate(() => window.__game.player.x);
  if (x > 19.5 && x < 21.5) await page.keyboard.press('Space', { delay: 250 });
  if (x > 55) break;
}
await page.keyboard.up('KeyD');
await sleep(600);
await shot('4_beacon');
await page.keyboard.press('KeyE');
await sleep(1300);
await shot('5_lighting');
await sleep(2500);
await shot('6_lit');
await page.keyboard.down('ShiftLeft');
await sleep(800);
await shot('7_raise');
await page.keyboard.up('ShiftLeft');
await page.keyboard.press('KeyF');
await sleep(150);
await shot('8_flare');
await sleep(1200);
await page.keyboard.press('Escape');
await sleep(700);
await shot('9_pause');
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
