// Continue-from-save and settings flow.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = process.env.BASE || 'http://localhost:8000/';
await page.goto(base, { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('lamplighter.save', JSON.stringify({ checkpoint: 3, stats: { time: 400, deaths: 2, fireflies: 30 }, fireflies: 30 })));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await sleep(2500);
await page.screenshot({ path: 'shots/save_1_title.png' });
// open settings (third item: 繼續 / 重新開始 / 設定)
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await sleep(600);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await sleep(300);
await page.screenshot({ path: 'shots/save_2_settings.png' });
console.log('settings', await page.evaluate(() => JSON.stringify(window.__game.ui.settings)));
await page.keyboard.press('Escape');
await sleep(500);
await page.keyboard.press('Enter'); // continue
await sleep(2500);
console.log('after continue', JSON.stringify(await page.evaluate(() => window.__info())));
console.log('cam', await page.evaluate(() => { const g = window.__game; const c = g.engine.camera.position; return JSON.stringify({cam:[c.x,c.y,c.z].map(v=>+v.toFixed(2)), hero:[g.hero.root.position.x, g.hero.root.position.y], vis: g.hero.root.visible, fade: g.engine.post.u.fade.value, gfade: g.fade, lit: g.beacons.map(b=>b.lit), cine: !!g.rig.cine, cineK: g.rig.cineK, state: g.state}); }));
await page.screenshot({ path: 'shots/save_3_continue.png' });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n'));
await browser.close();
