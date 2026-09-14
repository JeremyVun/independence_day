import { clamp } from './rng';

export interface Controls {
  pitch: number;
  roll: number;
  yaw: number;
  boost: number;
  brake: number;
  guns: boolean;
  lookX: number;
  lookY: number;
}

export type Action = 'missile' | 'camera' | 'pause' | 'confirm' | 'back' | 'left' | 'right' | 'up' | 'down';

const KEY_ACTIONS: Record<string, Action[]> = {
  KeyF: ['missile'],
  KeyC: ['camera'],
  Escape: ['pause', 'back'],
  Enter: ['confirm'],
  Space: ['confirm'],
  ArrowLeft: ['left'],
  ArrowRight: ['right'],
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  KeyA: ['left'],
  KeyD: ['right'],
  KeyW: ['up'],
  KeyS: ['down'],
  Backspace: ['back'],
};

const PAD_ACTIONS: [number, Action[]][] = [
  [0, ['confirm']],
  [1, ['missile', 'back']],
  [3, ['camera']],
  [9, ['pause']],
  [14, ['left']],
  [15, ['right']],
  [12, ['up']],
  [13, ['down']],
];

const deadzone = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class Input {
  readonly controls: Controls = { pitch: 0, roll: 0, yaw: 0, boost: 0, brake: 0, guns: false, lookX: 0, lookY: 0 };
  invertPitch = false;
  onPadConnected?: () => void;
  private keys = new Set<string>();
  private pending = new Map<Action, number>();
  private padPrev: boolean[] = [];
  private stickPrev = [0, 0];
  private keyPitch = 0;
  private keyRoll = 0;
  private keyYaw = 0;
  usingPad = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      if (!e.repeat) for (const a of KEY_ACTIONS[e.code] ?? []) this.push(a);
      this.keys.add(e.code);
      this.usingPad = false;
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', () => this.onPadConnected?.());
  }

  private key(...codes: string[]) {
    return codes.some((c) => this.keys.has(c)) ? 1 : 0;
  }

  private push(a: Action) {
    this.pending.set(a, (this.pending.get(a) ?? 0) + 1);
  }

  // Returns true once per press.
  take(action: Action): boolean {
    const n = this.pending.get(action) ?? 0;
    if (n > 1) this.pending.set(action, n - 1);
    else this.pending.delete(action);
    return n > 0;
  }

  clearActions() {
    this.pending.clear();
  }

  update(dt: number) {
    const c = this.controls;
    const approach = (cur: number, target: number, rate: number) =>
      target === 0 ? cur - Math.sign(cur) * Math.min(Math.abs(cur), rate * 1.6 * dt) : clamp(cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), rate * dt), -1, 1);
    this.keyPitch = approach(this.keyPitch, this.key('KeyS', 'ArrowDown') - this.key('KeyW', 'ArrowUp'), 3.5);
    this.keyRoll = approach(this.keyRoll, this.key('KeyD', 'ArrowRight') - this.key('KeyA', 'ArrowLeft'), 5);
    this.keyYaw = approach(this.keyYaw, this.key('KeyE') - this.key('KeyQ'), 4);
    let pitch = this.keyPitch;
    let roll = this.keyRoll;
    let yaw = this.keyYaw;
    let boost = this.key('ShiftLeft', 'ShiftRight');
    let brake = this.key('KeyX');
    let guns = this.keys.has('Space');
    let lookX = 0;
    let lookY = 0;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.buttons.length >= 10);
    if (pad) {
      const b = pad.buttons;
      const pressed = b.map((x) => x.pressed);
      if (pressed.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.3)) this.usingPad = true;
      for (const [i, acts] of PAD_ACTIONS) if (pressed[i] && !this.padPrev[i]) for (const a of acts) this.push(a);
      this.padPrev = pressed;
      const ax = pad.axes;
      const lx = deadzone(ax[0] ?? 0);
      const ly = deadzone(ax[1] ?? 0);
      const flick = (v: number, prev: number, neg: Action, pos: Action) => {
        if (Math.abs(v) > 0.6 && Math.abs(prev) < 0.4) this.push(v < 0 ? neg : pos);
      };
      flick(lx, this.stickPrev[0], 'left', 'right');
      flick(ly, this.stickPrev[1], 'up', 'down');
      this.stickPrev = [lx, ly];
      if (lx || ly) {
        roll = Math.sign(lx) * lx * lx;
        pitch = Math.sign(ly) * ly * ly;
      }
      yaw = clamp(yaw + (b[5]?.value ?? 0) - (b[4]?.value ?? 0), -1, 1);
      boost = Math.max(boost, b[7]?.value ?? 0);
      brake = Math.max(brake, b[6]?.value ?? 0);
      guns = guns || !!b[0]?.pressed;
      lookX = deadzone(ax[2] ?? 0);
      lookY = deadzone(ax[3] ?? 0);
    }

    c.pitch = this.invertPitch ? -pitch : pitch;
    c.roll = roll;
    c.yaw = yaw;
    c.boost = boost;
    c.brake = brake;
    c.guns = guns;
    c.lookX = lookX;
    c.lookY = lookY;
  }
}
