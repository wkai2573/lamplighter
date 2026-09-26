// DOM overlay: title, HUD, narration, chapter cards, menus, death & ending screens.
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const LANTERN_SVG = `<svg viewBox="0 0 30 44"><defs><radialGradient id="lg" cx="50%" cy="58%" r="50%"><stop offset="0" stop-color="#fff2d0"/><stop offset=".45" stop-color="#ffb46b"/><stop offset="1" stop-color="#ffb46b" stop-opacity="0"/></radialGradient></defs>
<path d="M11 6 Q15 0 19 6" fill="none" stroke="#8a7a66" stroke-width="1.4"/>
<path d="M8 12 L15 6 L22 12 Z" fill="#3a3028" stroke="#6d5d4a" stroke-width=".8"/>
<rect x="9" y="12" width="12" height="20" rx="1" fill="rgba(255,190,120,.08)" stroke="#6d5d4a" stroke-width=".9"/>
<circle class="lf" cx="15" cy="22" r="9" fill="url(#lg)"/>
<path class="fl" d="M15 17 Q18 22 15 26 Q12 22 15 17Z" fill="#fff0c8"/>
<rect x="7.5" y="32" width="15" height="3" fill="#3a3028" stroke="#6d5d4a" stroke-width=".8"/></svg>`;

export class UI {
  constructor(root) {
    this.root = root;
    this.menuStack = [];
    this.navCb = null;
    this.padPrev = {};
    this.settings = { master: 0.85, music: 0.7, sfx: 0.9, amb: 0.9, quality: 'high', shake: true };
    try {
      const s = JSON.parse(localStorage.getItem('lamplighter.settings') || 'null');
      if (s) Object.assign(this.settings, s);
    } catch {}
    this.build();
    addEventListener('keydown', (e) => this.onKey(e));
  }

  saveSettings() {
    try {
      localStorage.setItem('lamplighter.settings', JSON.stringify(this.settings));
    } catch {}
  }

  build() {
    const r = this.root;
    // HUD
    this.hud = h('div', 'layer', '');
    this.hud.id = 'hud';
    this.oil = h('div', 'oil', `${LANTERN_SVG}<div class="gauge"><u></u><i></i><b style="left:25%"></b></div><div class="lbl">燈油</div>`);
    this.oilBar = this.oil.querySelector('.gauge i');
    this.oilGhost = this.oil.querySelector('.gauge u');
    this.oilFlame = this.oil.querySelector('.fl');
    this.oilGlow = this.oil.querySelector('.lf');
    this.hud.appendChild(this.oil);
    this.promptEl = h('div', 'prompt hidden', '');
    this.hud.appendChild(this.promptEl);
    this.hintEl = h('div', 'hint hidden', '');
    this.hud.appendChild(this.hintEl);
    this.toastEl = h('div', 'toast hidden', '');
    this.hud.appendChild(this.toastEl);
    r.appendChild(this.hud);
    this.hud.classList.add('hidden');

    this.narrEl = h('div', 'narr', '');
    r.appendChild(this.narrEl);
    this.chapEl = h('div', 'chapter', '');
    r.appendChild(this.chapEl);
    this.deathEl = h('div', 'death hidden', '燈　火　熄　滅');
    r.appendChild(this.deathEl);
    this.endingEl = h('div', 'ending hidden', '');
    r.appendChild(this.endingEl);

    // title
    this.title = h('div', 'layer fade', `
      <div class="t-main">守燈人</div>
      <div class="t-sub">The Lamplighter</div>
      <div class="t-rule"></div>
      <div class="menu"></div>
      <div class="t-foot">建議使用 <b>電腦</b> 與 <b>耳機</b> 遊玩　·　支援手把　·　<b>M</b> 靜音</div>`);
    this.title.id = 'title';
    this.title.classList.add('hidden');
    r.appendChild(this.title);

    this.panel = h('div', 'panel hidden', '<div class="box"></div>');
    r.appendChild(this.panel);
    this.credits = h('div', 'credits hidden', '');
    r.appendChild(this.credits);
  }

  // ---------------------------------------------------------------- menus
  // items: [{label, action, disabled, value(), adjust(dir)}]
  openMenu(container, items, { onBack, rowClass = 'mi' } = {}) {
    container.innerHTML = '';
    const els = items.map((it, i) => {
      const e = h(rowClass === 'mi' ? 'button' : 'div', rowClass, '');
      if (it.disabled) e.setAttribute('disabled', '');
      e.addEventListener('mouseenter', () => !it.disabled && this.select(i));
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (it.disabled) return;
        this.select(i);
        if (it.adjust) {
          const rect = e.getBoundingClientRect();
          it.adjust(ev.clientX > rect.left + rect.width * 0.6 ? 1 : -1);
          this.renderMenu();
        } else it.action?.();
      });
      container.appendChild(e);
      return e;
    });
    this.menu = { container, items, els, sel: items.findIndex((it) => !it.disabled), onBack };
    this.renderMenu();
  }

  renderMenu() {
    const m = this.menu;
    if (!m) return;
    m.items.forEach((it, i) => {
      const e = m.els[i];
      if (it.value) {
        const v = it.value();
        const inner = typeof v === 'number' ? `<span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span><span>${Math.round(v * 100)}</span>` : `<span>${v}</span>`;
        e.innerHTML = `<span>${it.label}</span><span class="val">${inner}</span>`;
      } else e.textContent = it.label;
      e.classList.toggle('sel', i === m.sel);
    });
  }

  select(i) {
    if (!this.menu || this.menu.sel === i) return;
    this.menu.sel = i;
    this.onNav?.('move');
    this.renderMenu();
  }

  nav(dir) {
    const m = this.menu;
    if (!m) return;
    if (dir === 'up' || dir === 'down') {
      const n = m.items.length;
      let i = m.sel;
      for (let k = 0; k < n; k++) {
        i = (i + (dir === 'down' ? 1 : -1) + n) % n;
        if (!m.items[i].disabled) break;
      }
      this.select(i);
    } else if (dir === 'left' || dir === 'right') {
      const it = m.items[m.sel];
      if (it?.adjust) {
        it.adjust(dir === 'right' ? 1 : -1);
        this.onNav?.('move');
        this.renderMenu();
      }
    } else if (dir === 'ok') {
      const it = m.items[m.sel];
      if (it && !it.disabled) {
        if (it.adjust && !it.action) it.adjust(1), this.renderMenu();
        else {
          this.onNav?.('ok');
          it.action?.();
        }
      }
    } else if (dir === 'back') m.onBack?.();
  }

  onKey(e) {
    if (!this.menu || this.menuHidden()) return;
    const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'ok', Space: 'ok', KeyE: 'ok', Escape: 'back' };
    const d = map[e.code];
    if (d) {
      e.preventDefault();
      if (!e.repeat || d === 'left' || d === 'right' || d === 'up' || d === 'down') this.nav(d);
    }
  }

  menuHidden() {
    const c = this.menu?.container;
    if (!c) return true;
    const host = c.closest('.layer, .panel');
    return host?.classList.contains('hidden');
  }

  pollPad() {
    if (!this.menu || this.menuHidden()) return;
    const gp = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected);
    if (!gp) return;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    const st = { up: ay < -0.5 || b(12), down: ay > 0.5 || b(13), left: ax < -0.5 || b(14), right: ax > 0.5 || b(15), ok: b(0), back: b(1) || b(9) };
    for (const k in st) {
      if (st[k] && !this.padPrev[k]) this.nav(k);
    }
    this.padPrev = st;
  }

  // ---------------------------------------------------------------- screens
  showTitle(items) {
    this.title.classList.remove('hidden');
    this.openMenu(this.title.querySelector('.menu'), items);
  }

  hideTitle() {
    this.title.classList.add('hidden');
    this.menu = null;
  }

  showPanel(titleText, items, { onBack, note = '', html = '' } = {}) {
    const box = this.panel.querySelector('.box');
    box.innerHTML = `<h2>${titleText}</h2>${html}<div class="rows"></div>${note ? `<div class="note">${note}</div>` : ''}`;
    this.panel.classList.remove('hidden');
    this.openMenu(box.querySelector('.rows'), items, { onBack, rowClass: 'row' });
  }

  hidePanel() {
    this.panel.classList.add('hidden');
    this.menu = null;
  }

  // ---------------------------------------------------------------- HUD
  showHud(v) {
    this.hud.classList.toggle('hidden', !v);
  }

  setOil(oil, t) {
    const pct = Math.max(0, Math.min(1, oil)) * 100;
    this.oilBar.style.width = pct + '%';
    this.oilGhost.style.width = pct + '%';
    const low = oil < 0.25;
    this.oil.classList.toggle('low', low);
    const f = 0.4 + Math.sqrt(Math.max(0, oil)) * 0.6;
    this.oilFlame.setAttribute('transform', `translate(15 26) scale(${f * (0.9 + Math.sin(t * 13) * 0.05)}) translate(-15 -26)`);
    this.oilGlow.style.opacity = (0.3 + f * 0.7).toFixed(2);
  }

  setHudVisibility(k) {
    this.oil.style.opacity = k.toFixed(2);
  }

  prompt(text, x, y, holdK = -1) {
    if (!text) {
      this.promptEl.classList.add('hidden');
      return;
    }
    const html = `${text}${holdK >= 0 ? `<span class="hold"><i style="width:${Math.round(holdK * 100)}%"></i></span>` : ''}`;
    if (this._prompt !== html) this.promptEl.innerHTML = this._prompt = html;
    this.promptEl.style.left = x + 'px';
    this.promptEl.style.top = y + 'px';
    this.promptEl.classList.remove('hidden');
  }

  hint(html) {
    if (!html) {
      this.hintEl.classList.add('hidden');
      this._hint = null;
      return;
    }
    if (this._hint !== html) {
      this.hintEl.innerHTML = this._hint = html;
    }
    this.hintEl.classList.remove('hidden');
  }

  toast(text, sub = '', dur = 4) {
    this.toastEl.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.add('hidden'), dur * 1000);
  }

  narrate(lines) {
    clearTimeout(this._narrT);
    this.narrEl.innerHTML = '';
    const ps = lines.map((l) => {
      const p = h('p', '', l);
      this.narrEl.appendChild(p);
      return p;
    });
    ps.forEach((p, i) => setTimeout(() => p.classList.add('on'), 300 + i * 1900));
    const total = 300 + lines.length * 1900 + 3800;
    this._narrT = setTimeout(() => ps.forEach((p) => p.classList.remove('on')), total);
  }

  clearNarration() {
    this.narrEl.querySelectorAll('p').forEach((p) => p.classList.remove('on'));
  }

  chapter(c) {
    this.chapEl.innerHTML = `<div class="c-num">${c.num}</div><div class="c-name">${c.name}</div><div class="c-rule"></div><div class="c-sub" style="margin-top:14px">${c.sub}</div>`;
    this.chapEl.classList.remove('on');
    void this.chapEl.offsetWidth;
    this.chapEl.classList.add('on');
  }

  death(show) {
    this.deathEl.classList.toggle('hidden', !show);
  }

  endingText(lines, gap = 3.2) {
    this.endingEl.innerHTML = '';
    this.endingEl.classList.remove('hidden');
    const ps = lines.map((l) => {
      const p = h('p', '', l);
      this.endingEl.appendChild(p);
      return p;
    });
    ps.forEach((p, i) => setTimeout(() => p.classList.add('on'), 500 + i * gap * 1000));
    return 500 + lines.length * gap * 1000;
  }

  hideEndingText() {
    this.endingEl.querySelectorAll('p').forEach((p) => p.classList.remove('on'));
  }

  showCredits(stats, onDone) {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.credits.innerHTML = `
      <div class="c-t">守燈人</div><div class="c-s">The Lamplighter</div>
      <div class="stats">
        <div>${fmt(stats.time)}<small>旅程時間</small></div>
        <div>${stats.fireflies}<small>收集螢火</small></div>
        <div>${stats.beacons} / ${stats.beaconTotal}<small>點亮石燈</small></div>
        <div>${stats.deaths}<small>燈火熄滅</small></div>
      </div>
      <div class="c-line">一切畫面與聲音皆由程式即時生成<br>Three.js · Web Audio</div>
      <div class="c-go">感謝遊玩　·　按任意鍵回到標題</div>`;
    this.credits.classList.remove('hidden');
    setTimeout(() => {
      const done = () => {
        removeEventListener('keydown', done);
        removeEventListener('mousedown', done);
        clearInterval(this._padT);
        onDone();
      };
      addEventListener('keydown', done);
      addEventListener('mousedown', done);
      this._padT = setInterval(() => {
        const gp = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected);
        if (gp && gp.buttons.some((b) => b.pressed)) done();
      }, 100);
    }, 2500);
  }

  hideCredits() {
    this.credits.classList.add('hidden');
  }
}

export function keyLabel(action, device) {
  const pad = { interact: 'B', flare: 'X', raise: 'RT', jump: 'A' };
  const kb = { interact: 'E', flare: 'F', raise: 'Shift', jump: '空白鍵' };
  return `<kbd>${device === 'pad' ? pad[action] : kb[action]}</kbd>`;
}
