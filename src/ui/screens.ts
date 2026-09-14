import type { JetSpec } from '../aircraft/types';
import { LOADOUTS } from '../game/weapons';
import { copy, gameTitle, jetCopy } from './copy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class LoadingScreen {
  readonly root = el('div', 'screen loading');
  constructor(parent: HTMLElement) {
    this.root.append(el('p', 'label pulse', copy.loading));
    parent.append(this.root);
  }
  remove() {
    this.root.remove();
  }
}

export class TitleScreen {
  readonly root = el('div', 'screen title-screen shade-left');
  private prompt = el('p', 'label pulse');
  constructor(parent: HTMLElement) {
    const block = el('div', 'title-block');
    block.append(el('h1', 'game-title', gameTitle), el('div', 'rule'), this.prompt);
    this.root.append(block);
    parent.append(this.root);
    this.setPad(false);
  }
  setPad(pad: boolean) {
    this.prompt.textContent = pad ? copy.title.startController : copy.title.startKeyboard;
  }
  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }
}

export class HangarScreen {
  readonly root = el('div', 'screen hangar-screen shade-left');
  private counter = el('p', 'label dim');
  private name = el('h1', 'jet-name');
  private blurb = el('p', 'jet-blurb');
  private stats = el('div', 'stats');
  private loadout = el('div', 'loadout');
  private hints = el('div', 'hints');
  private info = el('div', 'jet-info');

  constructor(parent: HTMLElement) {
    this.info.append(this.counter, this.name, this.blurb, this.stats, this.loadout);
    this.root.append(this.info, this.hints);
    parent.append(this.root);
    this.setPad(false);
  }

  setJet(spec: JetSpec, index: number, total: number) {
    const c = jetCopy(spec.id);
    this.counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    this.name.textContent = c.name;
    this.blurb.textContent = c.blurb;
    this.stats.replaceChildren();
    const labels = copy.hangar.stats;
    for (const [key, value] of [
      [labels.speed, spec.stats.speed],
      [labels.handling, spec.stats.handling],
      [labels.armour, spec.stats.armour],
      [labels.weapons, spec.stats.weapons],
    ] as [string, number][]) {
      const row = el('div', 'stat');
      row.append(el('span', 'label', key));
      const bar = el('span', 'segments');
      for (let i = 0; i < 10; i++) bar.append(el('i', i < value ? 'on' : ''));
      row.append(bar);
      this.stats.append(row);
    }
    const l = LOADOUTS[spec.loadout ?? 'standard'];
    const weapon = copy.weapons[l.special];
    const row = (label: string, value: string) => {
      const r = el('div', 'stat');
      r.append(el('span', 'label', label), el('span', 'value', value));
      return r;
    };
    this.loadout.replaceChildren(row(copy.hangar.gunLabel, copy.guns[l.gun]), row(copy.hangar.weaponLabel, weapon.name), el('p', 'loadout-about', weapon.about));
    this.info.classList.remove('enter');
    void this.info.offsetWidth;
    this.info.classList.add('enter');
  }

  setPad(pad: boolean) {
    const h = copy.hangar.hints;
    const items: [string[], string][] = pad
      ? [
          [['◀', '▶'], h.change],
          [['A'], h.fly],
          [['B'], h.back],
        ]
      : [
          [['←', '→'], h.change],
          [['Enter'], h.fly],
          [['Esc'], h.back],
        ];
    this.hints.replaceChildren(
      ...items.map(([keys, label]) => {
        const s = el('span', 'hint');
        for (const k of keys) s.append(el('kbd', undefined, k));
        s.append(el('span', 'label', label));
        return s;
      }),
    );
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }
}

export interface MenuItem {
  label: () => string;
  action: () => void;
}

export class MenuScreen {
  readonly root = el('div', 'screen menu-screen shade-left hidden');
  private list = el('ul', 'menu');
  private items: MenuItem[] = [];
  private selected = 0;

  constructor(parent: HTMLElement, heading: string) {
    const block = el('div', 'menu-block');
    block.append(el('h2', 'menu-heading', heading), this.list);
    this.root.append(block);
    parent.append(this.root);
  }

  setItems(items: MenuItem[]) {
    this.items = items;
    this.selected = 0;
    this.render();
  }

  render() {
    this.list.replaceChildren(
      ...this.items.map((item, i) => {
        const li = el('li', i === this.selected ? 'selected' : '', item.label());
        li.addEventListener('pointerenter', () => {
          this.selected = i;
          this.render();
        });
        li.addEventListener('click', () => item.action());
        return li;
      }),
    );
  }

  move(delta: number) {
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.render();
  }

  activate() {
    this.items[this.selected]?.action();
    this.render();
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (on) {
      this.selected = 0;
      this.render();
    }
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}

const KEYBOARD_KEYS: Record<string, string> = {
  pitch: 'W / S · ↑ / ↓',
  roll: 'A / D · ← / →',
  yaw: 'Q / E',
  boost: 'Shift',
  brake: 'X',
  guns: 'Space',
  missile: 'F',
  camera: 'C',
  pause: 'Esc',
};
const PAD_KEYS: Record<string, string> = {
  pitch: 'L stick',
  roll: 'L stick',
  yaw: 'LB / RB',
  boost: 'RT',
  brake: 'LT',
  guns: 'A',
  missile: 'B',
  camera: 'Y',
  look: 'R stick',
  pause: 'Start',
};

export class ControlsScreen {
  readonly root = el('div', 'screen controls-screen shade-left hidden');

  constructor(parent: HTMLElement) {
    const block = el('div', 'controls-block');
    block.append(el('h2', 'menu-heading', copy.controls.heading));
    const cols = el('div', 'controls-cols');
    const actions = copy.controls.actions as Record<string, string>;
    for (const [title, keys, note] of [
      [copy.controls.keyboard.split('\n')[0], KEYBOARD_KEYS, copy.controls.keyboard.split('\n\n')[1]],
      [copy.controls.controller.split('\n')[0], PAD_KEYS, copy.controls.controller.split('\n\n')[1]],
    ] as [string, Record<string, string>, string][]) {
      const col = el('div', 'controls-col');
      col.append(el('p', 'label dim', title));
      const table = el('dl');
      for (const [action, key] of Object.entries(keys)) {
        table.append(el('dt', undefined, actions[action]), el('dd', undefined, key));
      }
      col.append(table);
      if (note) col.append(el('p', 'controls-note', note));
      cols.append(col);
    }
    block.append(cols, el('p', 'controls-note', copy.controls.specialNote));
    this.root.append(block);
    parent.append(this.root);
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }
}

export class Toast {
  readonly root = el('div', 'toast label hidden');
  private timer = 0;
  constructor(parent: HTMLElement) {
    parent.append(this.root);
  }
  show(text: string) {
    this.root.textContent = text;
    this.root.classList.remove('hidden');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.add('hidden'), 2600);
  }
}
