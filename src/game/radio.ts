import { copy } from '../ui/copy';

export type RadioGroup = 'ambient' | 'kill' | 'hit' | 'nearShip' | 'respawn' | 'rain' | 'blackout';

type Line = { speaker: string; text: string };

const SHOW = 4.5;
const GAP = 1.2;
const PRIORITY: Record<RadioGroup, number> = { respawn: 5, kill: 4, hit: 4, nearShip: 3, rain: 2, blackout: 2, ambient: 1 };
const COOLDOWN: Record<RadioGroup, number> = { respawn: 0, kill: 10, hit: 30, nearShip: 90, rain: 150, blackout: 60, ambient: 0 };

// Overheard radio traffic shown as subtitles: ambient reports now and then, and replies to what the player does.
export class Radio {
  current: { label: string; text: string; age: number } | null = null;
  opened = false;
  closed = false;
  private pending: RadioGroup | null = null;
  private gap = 0;
  private ambientIn = 30 + Math.random() * 20;
  private cooldown: Partial<Record<RadioGroup, number>> = {};
  private recent: Partial<Record<RadioGroup, number[]>> = {};

  get alpha(): number {
    const age = this.current?.age ?? 0;
    return Math.max(0, Math.min(1, age / 0.2, (SHOW - age) / 0.5));
  }

  trigger(group: RadioGroup) {
    if ((this.cooldown[group] ?? 0) > 0) return;
    if (this.pending && PRIORITY[this.pending] >= PRIORITY[group]) return;
    this.pending = group;
  }

  update(dt: number) {
    this.opened = this.closed = false;
    for (const k of Object.keys(this.cooldown) as RadioGroup[]) this.cooldown[k] = (this.cooldown[k] ?? 0) - dt;
    this.ambientIn -= dt;
    if (this.ambientIn <= 0) {
      this.ambientIn = 50 + Math.random() * 40;
      this.trigger('ambient');
    }
    if (this.current) {
      this.current.age += dt;
      if (this.current.age < SHOW) return;
      this.current = null;
      this.closed = true;
      this.gap = GAP;
    }
    this.gap -= dt;
    if (!this.pending || this.gap > 0) return;
    const line = this.pick(this.pending);
    this.cooldown[this.pending] = COOLDOWN[this.pending];
    this.pending = null;
    const speakers = copy.radio.speakers as Record<string, string>;
    this.current = { label: speakers[line.speaker] ?? line.speaker, text: line.text, age: 0 };
    this.opened = true;
  }

  // Random line from the group, avoiding the last few used.
  private pick(group: RadioGroup): Line {
    const lines = copy.radio[group] as Line[];
    const recent = (this.recent[group] ??= []);
    const fresh = lines.map((_, i) => i).filter((i) => !recent.includes(i));
    const i = fresh[Math.floor(Math.random() * fresh.length)] ?? 0;
    recent.push(i);
    if (recent.length > Math.floor(lines.length / 2)) recent.shift();
    return lines[i];
  }
}
