// Drive the real game with keyboard input and capture frames along the way.
// Usage: node tools/play.mjs <out-prefix> '<json steps>'
//   steps: [{"wait":ms} | {"press":"Enter"} | {"down":"KeyW"} | {"up":"KeyW"} | {"shot":"name"} | {"eval":"js"}]
//   env: BASE (default http://127.0.0.1:5217/), QUERY (appended), W/H viewport
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [prefix, stepsJson] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const base = process.env.BASE ?? 'http://127.0.0.1:5217/';
const width = Number(process.env.W ?? 1600);
const height = Number(process.env.H ?? 900);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?shot=1${process.env.QUERY ? '&' + process.env.QUERY : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  for (const s of steps) {
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.press) await page.keyboard.press(s.press);
    if (s.down) await page.keyboard.down(s.down);
    if (s.up) await page.keyboard.up(s.up);
    if (s.eval) console.log(JSON.stringify(await page.evaluate(s.eval)));
    if (s.shot) {
      await page.screenshot({ path: `${prefix}-${s.shot}.png` });
      console.log(`${prefix}-${s.shot}.png`);
    }
  }
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  console.log(`fps ~${fps.toFixed(1)} (headless)`);
} finally {
  await browser.close();
  const unique = [...new Set(errors)].filter((e) => !e.includes('Failed to load resource'));
  if (unique.length) {
    fs.writeFileSync(`${prefix}-console.log`, unique.join('\n\n'));
    console.log(unique.slice(0, 5).join('\n'));
  }
}
