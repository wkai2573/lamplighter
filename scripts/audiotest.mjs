// Checks that the synthesized audio is alive, finite and not clipping in several situations.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 90000 });
await page.keyboard.press('ArrowDown'); // unlocks audio (user gesture)
await sleep(500);
await page.evaluate(() => {
  const a = window.__game.audio.core;
  const an = a.ctx.createAnalyser();
  an.fftSize = 4096;
  a.comp.connect(an);
  window.__meter = () => {
    const b = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(b);
    let s = 0, pk = 0, bad = 0;
    for (const v of b) { if (!Number.isFinite(v)) bad++; s += v * v; pk = Math.max(pk, Math.abs(v)); }
    return { state: a.ctx.state, rms: +Math.sqrt(s / b.length).toFixed(4), peak: +pk.toFixed(3), nan: bad };
  };
});
const measure = async (label, ms = 2500) => {
  let worst = { rms: 0, peak: 0 };
  for (let i = 0; i < ms / 250; i++) {
    await sleep(250);
    const m = await page.evaluate(() => window.__meter());
    if (m.peak > worst.peak) worst = m;
  }
  console.log(label.padEnd(22), JSON.stringify(worst));
};
await measure('title music');
await page.keyboard.press('Enter');
await sleep(1500);
await measure('intro');
const tp = async (x) => page.evaluate((x) => { window.__game.placePlayer(x); }, x);
await sleep(3500);
await measure('forest walk', 3000);
await tp(230); await measure('village rain', 3000);
await page.evaluate(() => { window.__game.player.emit('flare'); window.__game.audio.sfx.thunder(1, 0.1); });
await measure('flare+thunder', 3000);
await tp(620); await measure('cave', 3000);
await tp(430); await measure('bridge wind', 3000);
await tp(776); await measure('chase', 3500);
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n'));
await browser.close();
