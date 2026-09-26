import { Engine } from './render/engine.js';
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';
import { AudioCore } from './audio/core.js';
import { Sfx } from './audio/sfx.js';
import { Ambience } from './audio/ambience.js';
import { Music } from './audio/music.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);

const ui = new UI($('#ui'));
const S = ui.settings;
const engine = new Engine($('#game'), params.get('q') || S.quality);

const core = new AudioCore();
const audio = { core, sfx: new Sfx(core), amb: new Ambience(core), music: new Music(core) };
core.vol = { master: S.master, music: S.music, sfx: S.sfx, amb: S.amb };
ui.onNav = (k) => audio.sfx.ui(k === 'ok' ? 'ok' : 'move');

let muted = false;
function unlockAudio() {
  if (core.ready) {
    core.unlock();
    return;
  }
  core.unlock();
  if (!core.ready) return;
  audio.amb.start();
  audio.music.start();
  if (game.state === 'title') audio.music.setMood('title');
}
addEventListener('keydown', unlockAudio);
addEventListener('mousedown', unlockAudio);
addEventListener('touchstart', unlockAudio);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    muted = !muted;
    core.setVolumes({ master: muted ? 0 : S.master });
    ui.toast(muted ? '靜音' : '聲音開啟');
  }
});

const game = new Game(engine, ui, audio, params);

// ------------------------------------------------------------------ menus
function titleMenu() {
  const save = Game.loadSave();
  const items = [];
  if (save) items.push({ label: '繼續旅程', action: () => begin(() => game.continueFrom(save)) });
  items.push({ label: save ? '重新開始' : '開始旅程', action: () => begin(() => game.startNew()) });
  items.push({ label: '設　　定', action: () => settingsPanel(titleMenu) });
  items.push({ label: '操作說明', action: () => controlsPanel(titleMenu) });
  ui.hidePanel();
  ui.showTitle(items);
}

function begin(fn) {
  unlockAudio();
  ui.hideTitle();
  game.fade = 1;
  setTimeout(() => {
    fn();
    game.fade = 0;
    document.body.classList.add('playing');
  }, 900);
}

function pct(v) {
  return Math.round(v * 10) / 10;
}

function settingsPanel(back) {
  const vol = (key, label) => ({
    label,
    value: () => S[key],
    adjust: (d) => {
      S[key] = Math.max(0, Math.min(1, pct(S[key] + d * 0.1)));
      core.setVolumes({ [key]: key === 'master' && muted ? 0 : S[key] });
      ui.saveSettings();
    },
  });
  const qNames = { high: '高', medium: '中', low: '低' };
  const qOrder = ['low', 'medium', 'high'];
  ui.showPanel('設　定', [
    vol('master', '主音量'),
    vol('music', '音　樂'),
    vol('sfx', '音　效'),
    vol('amb', '環境音'),
    {
      label: '畫　質',
      value: () => qNames[S.quality],
      adjust: (d) => {
        const i = Math.max(0, Math.min(2, qOrder.indexOf(S.quality) + d));
        S.quality = qOrder[i];
        engine.setQuality(S.quality);
        ui.saveSettings();
      },
    },
    {
      label: '畫面震動',
      value: () => (S.shake ? '開' : '關'),
      adjust: () => {
        S.shake = !S.shake;
        ui.saveSettings();
      },
    },
    { label: '返　回', action: back },
  ], { onBack: back, note: '← → 調整　·　Esc 返回' });
}

function controlsPanel(back) {
  ui.showPanel('操作說明', [{ label: '返　回', action: back }], {
    onBack: back,
    html: `<table class="keys">
      <tr><td><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></td><td>移動</td></tr>
      <tr><td><kbd>空白鍵</kbd> / <kbd>W</kbd></td><td>跳躍（長按跳得更高）</td></tr>
      <tr><td><kbd>S</kbd> + <kbd>空白鍵</kbd></td><td>從木板上落下</td></tr>
      <tr><td><kbd>Shift</kbd> / <kbd>滑鼠右鍵</kbd></td><td>高舉提燈：照得更遠，驅退暗影，燈油消耗加快</td></tr>
      <tr><td><kbd>F</kbd> / <kbd>滑鼠左鍵</kbd></td><td>光爆：消耗燈油，驅散周圍的暗影</td></tr>
      <tr><td><kbd>E</kbd></td><td>點亮石燈（存檔點，補滿燈油）</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>暫停</td></tr>
      <tr><td><kbd>M</kbd></td><td>靜音</td></tr>
    </table><div class="note">也支援遊戲手把　·　建議戴上耳機</div>`,
  });
}

let paused = false;
function pauseMenu() {
  ui.showPanel('暫　停', [
    { label: '繼　續', action: resume },
    { label: '設　定', action: () => settingsPanel(pauseMenu) },
    { label: '操作說明', action: () => controlsPanel(pauseMenu) },
    { label: '回到標題', action: () => { resume(); game.fade = 1; setTimeout(() => { game.toTitle(); titleMenu(); }, 800); document.body.classList.remove('playing'); } },
  ], { onBack: resume });
}
function pause() {
  if (paused || game.state !== 'play' || game.ending) return;
  paused = true;
  core.setMuffle(900, 0.2);
  document.body.classList.remove('playing');
  pauseMenu();
}
function resume() {
  paused = false;
  ui.hidePanel();
  core.setMuffle(game.player.dead ? 500 : 20000, 0.3);
  document.body.classList.add('playing');
}
addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && !paused && game.state === 'play') {
    e.preventDefault();
    setTimeout(pause, 0);
  }
});
addEventListener('blur', () => {
  if (game.state === 'play' && !params.has('skip')) pause();
});
game.onCreditsDone = () => {
  game.toTitle();
  document.body.classList.remove('playing');
  titleMenu();
};

// ------------------------------------------------------------------ boot
(async () => {
  const bar = $('#loading .lbar i'), msg = $('#loading .lmsg');
  await game.build((k, m) => {
    bar.style.width = Math.round(k * 100) + '%';
    if (m) msg.textContent = m;
  });
  if (params.has('skip')) {
    game.startNew();
    game.state = 'play';
    game.player.ctrl = true;
    game.player.lanternOut = false;
    if (params.has('x')) game.placePlayer(parseFloat(params.get('x')));
    if (params.has('oil')) game.player.oil = parseFloat(params.get('oil'));
    if (params.has('lit')) for (let i = 0; i < +params.get('lit'); i++) game.setBeaconLit(game.beacons[i], true, true);
    ui.showHud(true);
    game.fade = 0;
    engine.post.u.fade.value = 0;
    if (params.has('auto')) game.input.held.right = 1;
    if (params.has('raise')) game.input.held.raise = 1;
  } else {
    game.toTitle();
    game.fade = 0;
    titleMenu();
  }
  $('#loading').classList.add('hide');

  let last = performance.now();
  let fpsT = 0, frames = 0, slow = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ui.pollPad();
    if (!paused) {
      game.input.pollGamepad();
      if (game.input.pressed.pause && game.state === 'play') pause();
      game.update(dt);
    } else game.input.endFrame();
    game.render();
    // adaptive quality: step down if the frame rate stays low
    fpsT += dt;
    frames++;
    if (fpsT > 2) {
      const fps = frames / fpsT;
      window.__fps = fps;
      slow = fps < 38 && game.state === 'play' && !document.hidden ? slow + 1 : 0;
      if (slow >= 3 && S.quality !== 'low' && !params.has('q')) {
        S.quality = S.quality === 'high' ? 'medium' : 'low';
        engine.setQuality(S.quality);
        ui.toast('畫質已自動調整', S.quality === 'medium' ? '中' : '低');
        slow = 0;
      }
      fpsT = 0;
      frames = 0;
    }
  };
  requestAnimationFrame(loop);
  window.__ready = true;
  window.__game = game;
  window.__info = () => ({
    x: +game.player.x.toFixed(2), y: +game.player.y.toFixed(2), state: game.state, oil: +game.player.oil.toFixed(2),
    dead: game.player.dead, fps: window.__fps && +window.__fps.toFixed(1), cp: game.checkpoint,
  });
})().catch((e) => {
  console.error(e);
  $('#loading .lmsg').textContent = '載入失敗：' + e.message;
});
