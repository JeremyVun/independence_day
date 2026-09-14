import * as THREE from 'three';
import { copy, fill } from './copy';

export interface HudState {
  mode: 'chase' | 'cockpit' | 'flyby';
  speed: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  boostFuel: number;
  boosting: boolean;
  health: number;
  weapon: { text: string; ready: boolean };
  kills: number;
  aim: THREE.Vector3 | null;
  locks: { pos: THREE.Vector3; progress: number }[];
  lockCount: number | null;
  radar: { px: number; pz: number; heading: number; aliens: { x: number; z: number; hot: boolean }[] };
  pullUp: boolean;
  turnBack: boolean;
  event: string | null;
  countdown: number | null;
  radio: { label: string; text: string; alpha: number } | null;
}

const GREEN = 'rgba(150, 255, 175, 0.92)';
const DIM = 'rgba(150, 255, 175, 0.45)';
const HOT = 'rgba(255, 120, 90, 0.95)';
const FONT = '"SF Mono", Menlo, Monaco, Consolas, monospace';

export class Hud {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private tmp = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas.className = 'hud';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private project(p: THREE.Vector3, camera: THREE.Camera): [number, number] | null {
    const v = this.tmp.copy(p).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * this.w, ((1 - v.y) / 2) * this.h];
  }

  private text(s: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', color = GREEN) {
    const c = this.ctx;
    c.font = `${size}px ${FONT}`;
    c.textAlign = align;
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  draw(s: HudState, camera: THREE.Camera, time: number) {
    this.resize();
    const c = this.ctx;
    const { w, h } = this;
    c.clearRect(0, 0, w, h);
    c.shadowColor = 'rgba(120, 255, 160, 0.6)';
    c.shadowBlur = 6;
    c.lineWidth = 1.5;
    c.strokeStyle = GREEN;
    const scale = Math.min(1.25, Math.max(0.75, h / 900));

    if (s.event) {
      this.text(s.event, w / 2, h * 0.42, 26 * scale, 'center');
      if (s.countdown !== null) this.text(fill(copy.events.respawn, s.countdown), w / 2, h * 0.42 + 34 * scale, 16 * scale, 'center', DIM);
    }
    if (s.radio) this.radioLine(s.radio, scale);
    if (s.mode === 'flyby' || s.event) return;

    if (s.aim) {
      const p = this.project(s.aim, camera);
      if (p) {
        c.beginPath();
        c.arc(p[0], p[1], 9 * scale, 0, Math.PI * 2);
        c.moveTo(p[0] - 20 * scale, p[1]);
        c.lineTo(p[0] - 12 * scale, p[1]);
        c.moveTo(p[0] + 12 * scale, p[1]);
        c.lineTo(p[0] + 20 * scale, p[1]);
        c.moveTo(p[0], p[1] - 12 * scale);
        c.lineTo(p[0], p[1] - 20 * scale);
        c.stroke();
        c.fillStyle = GREEN;
        c.fillRect(p[0] - 1, p[1] - 1, 2, 2);
      }
    }

    if (s.mode === 'cockpit') this.ladder(s, scale);

    const midY = h * 0.5;
    const boxW = 92 * scale;
    const boxH = 30 * scale;
    const leftX = w * 0.5 - 300 * scale;
    const rightX = w * 0.5 + 300 * scale;
    this.tape(leftX, midY, s.speed * 1.944, 50, 'right', scale);
    this.tape(rightX, midY, s.altitude * 3.281, 250, 'left', scale);
    c.strokeRect(leftX - boxW, midY - boxH / 2, boxW, boxH);
    c.strokeRect(rightX, midY - boxH / 2, boxW, boxH);
    this.text(String(Math.round(s.speed * 1.944)), leftX - 10 * scale, midY + 8 * scale, 22 * scale, 'right');
    this.text(String(Math.round(s.altitude * 3.281)), rightX + boxW - 10 * scale, midY + 8 * scale, 22 * scale, 'right');
    this.text(copy.hud.speed, leftX - boxW, midY - boxH / 2 - 8 * scale, 12 * scale, 'left', DIM);
    this.text(copy.hud.altitude, rightX, midY - boxH / 2 - 8 * scale, 12 * scale, 'left', DIM);

    this.headingTape(w / 2, 46 * scale, s.heading, scale);
    this.radar(118 * scale, h - 118 * scale, 92 * scale, s, scale);

    const bx = w - 260 * scale;
    const by = h - 150 * scale;
    this.bar(bx, by, 200 * scale, copy.hud.health, 1 - s.health / 100, scale, s.health < 35);
    this.bar(bx, by + 44 * scale, 200 * scale, copy.hud.boost, s.boostFuel, scale, false);
    this.text(s.weapon.text, bx, by + 96 * scale, 14 * scale, 'left', s.weapon.ready ? GREEN : DIM);
    this.text(`${copy.hud.kills}: ${s.kills}`, bx, by + 120 * scale, 14 * scale, 'left');
    if (s.lockCount) this.text(fill(copy.hud.locks, s.lockCount), bx, by + 72 * scale, 14 * scale, 'left', HOT);

    for (const lock of s.locks) {
      const p = this.project(lock.pos, camera);
      if (p) {
        const locked = lock.progress >= 1;
        const r = (locked ? 18 : 30 - 12 * lock.progress) * scale;
        c.strokeStyle = locked ? HOT : GREEN;
        c.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          c.moveTo(p[0] + sx * r, p[1] + sy * r * 0.45);
          c.lineTo(p[0] + sx * r, p[1] + sy * r);
          c.lineTo(p[0] + sx * r * 0.45, p[1] + sy * r);
        }
        c.stroke();
        c.strokeStyle = GREEN;
        if (locked && s.lockCount === null) this.text(copy.hud.locked, p[0], p[1] + r + 18 * scale, 13 * scale, 'center', HOT);
      }
    }

    const flash = Math.sin(time * 9) > -0.2;
    if (s.pullUp && flash) this.text(copy.warnings.pullUp, w / 2, h * 0.3, 24 * scale, 'center', HOT);
    else if (s.turnBack) this.text(copy.warnings.turnBack, w / 2, h * 0.3, 20 * scale, 'center');
  }

  // x is the box edge facing the screen centre; ticks point toward the centre, labels sit over the box column.
  private tape(x: number, y: number, value: number, step: number, side: 'left' | 'right', scale: number) {
    const c = this.ctx;
    const span = 150 * scale;
    const pxPer = (32 * scale) / step;
    const toCentre = side === 'right' ? 1 : -1;
    const boxW = 92 * scale;
    c.save();
    c.beginPath();
    c.rect(toCentre > 0 ? x - boxW : x - 14 * scale, y - span, boxW + 14 * scale, span * 2);
    c.clip();
    const first = Math.floor((value - span / pxPer) / step) * step;
    c.beginPath();
    c.strokeStyle = DIM;
    for (let v = first; v < value + span / pxPer; v += step) {
      if (v < 0) continue;
      const ty = y - (v - value) * pxPer;
      const major = Math.round(v / step) % 2 === 0;
      c.moveTo(x, ty);
      c.lineTo(x + toCentre * (major ? 12 : 6) * scale, ty);
      if (major && Math.abs(ty - y) > 44 * scale) this.text(String(Math.round(v)), x - toCentre * 10 * scale, ty + 4 * scale, 11 * scale, toCentre > 0 ? 'right' : 'left', DIM);
    }
    c.stroke();
    c.restore();
    c.strokeStyle = GREEN;
  }

  private headingTape(cx: number, y: number, heading: number, scale: number) {
    const c = this.ctx;
    const deg = ((THREE.MathUtils.radToDeg(heading) % 360) + 360) % 360;
    const pxPer = 4 * scale;
    c.beginPath();
    c.strokeStyle = DIM;
    for (let d = Math.floor(deg / 5) * 5 - 40; d <= deg + 40; d += 5) {
      const x = cx + (d - deg) * pxPer;
      const major = d % 15 === 0;
      c.moveTo(x, y);
      c.lineTo(x, y + (major ? 10 : 5) * scale);
      if (d % 30 === 0) this.text(String(((d % 360) + 360) % 360).padStart(3, '0'), x, y - 6 * scale, 11 * scale, 'center', DIM);
    }
    c.stroke();
    c.strokeStyle = GREEN;
    c.beginPath();
    c.moveTo(cx, y + 14 * scale);
    c.lineTo(cx - 6 * scale, y + 22 * scale);
    c.lineTo(cx + 6 * scale, y + 22 * scale);
    c.closePath();
    c.stroke();
  }

  private radar(cx: number, cy: number, r: number, s: HudState, scale: number) {
    const c = this.ctx;
    const range = 3200;
    c.strokeStyle = DIM;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.moveTo(cx + r * 0.5, cy);
    c.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    c.stroke();
    const cos = Math.cos(s.radar.heading);
    const sin = Math.sin(s.radar.heading);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - s.radar.px;
      const dz = z - s.radar.pz;
      const rx = dx * cos - -dz * sin;
      const ry = dx * sin + -dz * cos;
      return [cx + (rx / range) * r, cy - (ry / range) * r];
    };
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    c.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const [x, y] = toScreen(Math.sin(a) * 2800, Math.cos(a) * 2800);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(120, 255, 220, 0.3)';
    c.stroke();
    for (const a of s.radar.aliens) {
      const [x, y] = toScreen(a.x, a.z);
      c.fillStyle = a.hot ? HOT : 'rgba(255, 170, 120, 0.55)';
      c.fillRect(x - 2.5 * scale, y - 2.5 * scale, 5 * scale, 5 * scale);
    }
    c.restore();
    c.strokeStyle = GREEN;
    c.beginPath();
    c.moveTo(cx, cy - 7 * scale);
    c.lineTo(cx - 5 * scale, cy + 5 * scale);
    c.lineTo(cx + 5 * scale, cy + 5 * scale);
    c.closePath();
    c.stroke();
  }

  private radioLine(r: { label: string; text: string; alpha: number }, scale: number) {
    const c = this.ctx;
    const label = `${r.label}: `;
    c.font = `${14 * scale}px ${FONT}`;
    const lw = c.measureText(label).width;
    c.font = `${16 * scale}px ${FONT}`;
    const tw = c.measureText(r.text).width;
    const x = this.w / 2 - (lw + tw) / 2;
    const y = this.h - 62 * scale;
    c.globalAlpha = r.alpha;
    this.text(label, x, y, 14 * scale, 'left', DIM);
    this.text(r.text, x + lw, y, 16 * scale, 'left');
    c.globalAlpha = 1;
  }

  private bar(x: number, y: number, width: number, label: string, fillAmount: number, scale: number, warn: boolean) {
    const c = this.ctx;
    this.text(label, x, y, 12 * scale, 'left', DIM);
    c.strokeStyle = warn ? HOT : GREEN;
    c.strokeRect(x, y + 8 * scale, width, 10 * scale);
    c.fillStyle = warn ? HOT : GREEN;
    c.fillRect(x + 2, y + 8 * scale + 2, Math.max(0, (width - 4) * Math.min(1, fillAmount)), 10 * scale - 4);
    c.strokeStyle = GREEN;
  }

  private ladder(s: HudState, scale: number) {
    const c = this.ctx;
    const { w, h } = this;
    const pxPerDeg = h / 70;
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-s.roll);
    c.beginPath();
    c.strokeStyle = DIM;
    const pitchDeg = THREE.MathUtils.radToDeg(s.pitch);
    for (let d = -90; d <= 90; d += 10) {
      const y = (pitchDeg - d) * pxPerDeg;
      if (Math.abs(y) > h * 0.32) continue;
      const half = (d === 0 ? 220 : 90) * scale;
      const gap = 40 * scale;
      if (d < 0) c.setLineDash([6, 5]);
      else c.setLineDash([]);
      c.moveTo(-half, y);
      c.lineTo(-gap, y);
      c.moveTo(gap, y);
      c.lineTo(half, y);
      c.stroke();
      c.beginPath();
      if (d !== 0) {
        this.text(String(Math.abs(d)), -half - 8 * scale, y + 4 * scale, 11 * scale, 'right', DIM);
        this.text(String(Math.abs(d)), half + 8 * scale, y + 4 * scale, 11 * scale, 'left', DIM);
      }
    }
    c.setLineDash([]);
    c.restore();
    c.strokeStyle = GREEN;
  }
}
