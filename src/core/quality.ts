import type { Renderer } from './renderer';

const STEPS = [1.5, 1.25, 1.0];
const BUDGET_MS = 1000 / 55;

// Steps the render resolution down when frames keep missing 60 fps and the GPU is the reason. It never steps
// back up: on a 60 Hz display a fast frame still arrives 16.7 ms after the last, so headroom is invisible.
// The ratio is re-probed from the top on every launch instead.
export class DynamicResolution {
  private slow = 0;
  private settle = 3;

  constructor(private renderer: Renderer) {}

  frame(frameMs: number, cpuMs: number) {
    const dt = frameMs / 1000;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    if (frameMs > 100) return;
    const gpuBound = cpuMs < frameMs * 0.5;
    if (frameMs > BUDGET_MS && gpuBound) this.slow += dt;
    else this.slow = Math.max(0, this.slow - dt * 0.5);
    if (this.slow < 1.5) return;
    this.slow = 0;
    this.settle = 3;
    const next = STEPS.find((s) => s < this.renderer.pixelRatio - 1e-3);
    if (next === undefined) return;
    console.info(`night-flight: render scale ${this.renderer.pixelRatio} -> ${next}`);
    this.renderer.pixelRatio = next;
    this.renderer.resize();
  }
}
