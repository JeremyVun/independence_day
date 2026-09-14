// Screenshot the running dev server with real Chrome (GPU) for visual QA.
// Usage: node tools/shoot.mjs <out-prefix> <query> [<query> ...]
//   env: BASE (default http://localhost:5217/), W/H viewport (default 1600x900), WAIT extra ms after ready
// Each query is appended to BASE, e.g. "cam=0,300,1500,0,-8&t=10". Output: <out-prefix>-<n>.png
import { chromium } from 'playwright-core';

const [prefix, ...queries] = process.argv.slice(2);
if (!prefix || queries.length === 0) {
  console.error('usage: node tools/shoot.mjs <out-prefix> <query> [...]');
  process.exit(1);
}
const base = process.env.BASE ?? 'http://localhost:5217/';
const width = Number(process.env.W ?? 1600);
const height = Number(process.env.H ?? 900);
const wait = Number(process.env.WAIT ?? 300);

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  for (let i = 0; i < queries.length; i++) {
    const sep = queries[i].startsWith('?') ? '' : '?';
    const url = `${base}${sep}${queries[i]}${queries[i].includes('shot') ? '' : '&shot=1'}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(wait);
    const vp = await page.evaluate(() => [innerWidth, innerHeight]);
    if (vp[0] !== width || vp[1] !== height) throw new Error(`viewport ${vp} != ${width}x${height}`);
    const stats = await page.evaluate(() => window.__stats ?? null);
    const out = `${prefix}-${i + 1}.png`;
    await page.screenshot({ path: out });
    console.log(`${out}  ${Date.now() - t0}ms  ${stats ? JSON.stringify(stats) : ''}`);
  }
  const unique = [...new Set(errors)].filter((e) => !e.includes('Failed to load resource'));
  if (unique.length) {
    const fs = await import('node:fs');
    fs.writeFileSync(`${prefix}-console.log`, unique.join('\n\n'));
    console.log(`${unique.length} console errors/warnings -> ${prefix}-console.log`);
    for (const e of unique.slice(0, 6)) console.log(e.split('\n').filter((l) => /ERROR|error|Error/.test(l)).slice(0, 8).join('\n') || e.slice(0, 300));
  }
} finally {
  await browser.close();
}
