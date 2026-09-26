// Unified keyboard / mouse / gamepad input.
// Held states: left, right, down, up, jump, raise.  Edge presses: jumpP, flareP, interactP, pauseP, anyP.
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyS: 'down', ArrowDown: 'down',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump', KeyK: 'jump',
  ShiftLeft: 'raise', ShiftRight: 'raise', KeyL: 'raise',
  KeyF: 'flare', KeyJ: 'flare',
  KeyE: 'interact', Enter: 'interact',
  Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor() {
    this.held = { left: 0, right: 0, down: 0, jump: 0, raise: 0, flare: 0, interact: 0, pause: 0 };
    this.pressed = {};
    this.anyPressed = false;
    this.lastDevice = 'kb';
    this.enabled = true;
    this._pad = { prev: {} };
    const set = (name, v) => {
      if (v && !this.held[name]) this.pressed[name] = true;
      this.held[name] = v;
    };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.anyPressed = true;
      this.lastDevice = 'kb';
      const a = KEYMAP[e.code];
      if (a) {
        set(a, 1);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held[a] = 0;
    });
    addEventListener('mousedown', (e) => {
      this.anyPressed = true;
      this.lastDevice = 'kb';
      if (e.button === 0) set('flare', 1);
      if (e.button === 2) set('raise', 1);
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.flare = 0;
      if (e.button === 2) this.held.raise = 0;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => {
      for (const k in this.held) this.held[k] = 0;
    });
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return;
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].pressed || gp.buttons[i].value > 0.5 : false);
    const ax = gp.axes[0] || 0;
    const st = {
      left: ax < -0.35 || b(14),
      right: ax > 0.35 || b(15),
      down: (gp.axes[1] || 0) > 0.6 || b(13),
      jump: b(0),
      flare: b(2) || b(5),
      raise: b(6) || b(7) || b(4),
      interact: b(1) || b(3),
      pause: b(9),
    };
    for (const k in st) {
      const was = this._pad.prev[k] || false;
      if (st[k] && !was) {
        this.pressed[k] = true;
        this.anyPressed = true;
        this.lastDevice = 'pad';
      }
      if (st[k] !== was) this.held[k] = st[k] ? 1 : 0;
    }
    this._pad.prev = st;
  }

  get axis() {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  consume(name) {
    const p = !!this.pressed[name];
    this.pressed[name] = false;
    return p;
  }

  endFrame() {
    this.pressed = {};
    this.anyPressed = false;
  }
}
