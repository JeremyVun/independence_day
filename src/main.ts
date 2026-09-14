import * as THREE from 'three';
import { AudioEngine, type FlightSound } from './audio/audio';
import { Input } from './core/input';
import { Renderer } from './core/renderer';
import { ROSTER } from './aircraft/roster';
import { LiveBackdrop } from './scenes/backdrop';
import { flightMode, type FlightMode } from './scenes/flight';
import { hangarMode, type HangarMode } from './scenes/hangar';
import { jetViewer } from './scenes/jetViewer';
import type { Mode } from './scenes/mode';
import { titleMode } from './scenes/title';
import { copy } from './ui/copy';
import { ControlsScreen, HangarScreen, LoadingScreen, MenuScreen, TitleScreen, Toast } from './ui/screens';
import { updatePointScale } from './world/lights';
import { SHIP_CORE } from './world/mothership';
import { World } from './world/world';

declare global {
  interface Window {
    __ready?: boolean;
    __frames?: number;
    __stats?: unknown;
    __game?: { flight: FlightMode | null; world: World; renderer: Renderer };
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const renderer = new Renderer(canvas);
renderer.gl.info.autoReset = false;
renderer.rays.source.copy(SHIP_CORE);
const input = new Input();
const audio = new AudioEngine();
const size = new THREE.Vector2();
const bufferHeight = () => renderer.gl.getDrawingBufferSize(size).y;

const settings = {
  invertPitch: localStorage.getItem('invertPitch') === '1',
  sound: localStorage.getItem('sound') !== '0',
  jet: Math.max(0, Math.min(ROSTER.length - 1, Number(localStorage.getItem('jet') ?? 0))),
};
const save = () => {
  localStorage.setItem('invertPitch', settings.invertPitch ? '1' : '0');
  localStorage.setItem('sound', settings.sound ? '1' : '0');
  localStorage.setItem('jet', String(settings.jet));
};
input.invertPitch = settings.invertPitch;
audio.setEnabled(settings.sound);

type State = 'title' | 'hangar' | 'flight' | 'viewer';
let state: State = 'title';
let mode: Mode | null = null;
let world: World;
let hangar: HangarMode | null = null;
let backdrop: LiveBackdrop | null = null;
let flight: FlightMode | null = null;
let paused = false;

const loading = new LoadingScreen(ui);
let titleUi: TitleScreen;
let hangarUi: HangarScreen;
let pauseMenu: MenuScreen;
let controlsUi: ControlsScreen;
let toast: Toast;
const fade = document.createElement('div');
fade.className = 'fade';

function transition(fn: () => void) {
  fade.classList.add('on');
  window.setTimeout(() => {
    fn();
    fade.classList.remove('on');
  }, 320);
}

function leaveFlight() {
  if (!flight) return;
  flight.dispose?.();
  flight = null;
  paused = false;
  pauseMenu.show(false);
  controlsUi.show(false);
}

function goTitle() {
  leaveFlight();
  state = 'title';
  audio.scene = 'title';
  mode = titleMode(world, bufferHeight);
  hangarUi.show(false);
  titleUi.show(true);
}

function goHangar() {
  leaveFlight();
  if (!backdrop) backdrop = new LiveBackdrop(renderer.gl, world);
  if (!hangar) {
    hangar = hangarMode(renderer.gl, backdrop.texture);
    hangar.select(settings.jet);
  }
  state = 'hangar';
  audio.scene = 'hangar';
  mode = hangar;
  hangarUi.setJet(ROSTER[hangar.index], hangar.index, ROSTER.length);
  titleUi.show(false);
  hangarUi.show(true);
}

function goFlight(jetId: string, testParams = new URLSearchParams()) {
  leaveFlight();
  hangarUi.show(false);
  titleUi.show(false);
  flight = flightMode(renderer.gl, world, input, jetId, testParams, ui);
  state = 'flight';
  audio.scene = 'flight';
  mode = flight;
  input.clearActions();
}

function setPaused(on: boolean) {
  paused = on;
  pauseMenu.show(on);
  controlsUi.show(false);
  input.clearActions();
}

function buildUi() {
  titleUi = new TitleScreen(ui);
  hangarUi = new HangarScreen(ui);
  hangarUi.show(false);
  pauseMenu = new MenuScreen(ui, copy.pause.heading);
  controlsUi = new ControlsScreen(ui);
  toast = new Toast(ui);
  ui.append(fade);
  const onOff = (v: boolean) => (v ? copy.pause.on : copy.pause.off);
  pauseMenu.setItems([
    { label: () => copy.pause.resume, action: () => setPaused(false) },
    { label: () => copy.pause.changeJet, action: () => transition(goHangar) },
    {
      label: () => copy.pause.controls,
      action: () => {
        pauseMenu.show(false);
        controlsUi.show(true);
      },
    },
    {
      label: () => `${copy.pause.invertPitch}: ${onOff(settings.invertPitch)}`,
      action: () => {
        settings.invertPitch = !settings.invertPitch;
        input.invertPitch = settings.invertPitch;
        save();
      },
    },
    {
      label: () => `${copy.pause.sound}: ${onOff(settings.sound)}`,
      action: () => {
        settings.sound = !settings.sound;
        audio.setEnabled(settings.sound);
        save();
      },
    },
    { label: () => copy.pause.quit, action: () => transition(goTitle) },
  ]);
  input.onPadConnected = () => toast.show(copy.events.controllerConnected);
}

function start() {
  world = new World({ weather: params.get('weather') });
  buildUi();
  const sceneName = params.get('scene') ?? 'title';
  if (sceneName === 'jets') {
    state = 'viewer';
    mode = jetViewer(renderer.gl, params);
    titleUi.show(false);
  } else if (sceneName === 'city') {
    state = 'viewer';
    const camera = new THREE.PerspectiveCamera(65, 1, 1, 60000);
    camera.layers.enable(1);
    const cam = (params.get('cam') ?? '-900,160,1400,-35,-4').split(',').map(Number);
    camera.position.set(cam[0], cam[1], cam[2]);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(THREE.MathUtils.degToRad(cam[4]), THREE.MathUtils.degToRad(cam[3]), 0);
    mode = { scene: world.scene, camera, update: (dt, time) => world.update(dt, time, camera, bufferHeight()) };
    titleUi.show(false);
  } else if (sceneName === 'hangar') {
    if (params.has('jet')) settings.jet = Math.max(0, ROSTER.findIndex((j) => j.id === params.get('jet')));
    goHangar();
  } else if (sceneName === 'flight') {
    goFlight(params.get('jet') ?? ROSTER[settings.jet].id, params);
  } else goTitle();
  loading.remove();
  requestAnimationFrame(frame);
}

function handleInput() {
  const wake = () => {
    if (!audio.started) audio.start();
  };
  if (state === 'title') {
    titleUi.setPad(input.usingPad);
    if (input.take('confirm')) {
      wake();
      audio.uiConfirm();
      transition(goHangar);
    }
  } else if (state === 'hangar' && hangar) {
    hangarUi.setPad(input.usingPad);
    const delta = (input.take('right') ? 1 : 0) - (input.take('left') ? 1 : 0);
    if (delta) {
      wake();
      hangar.select(delta);
      settings.jet = hangar.index;
      save();
      hangarUi.setJet(ROSTER[hangar.index], hangar.index, ROSTER.length);
      audio.jetSwap();
    }
    if (input.take('confirm')) {
      wake();
      audio.uiConfirm();
      const id = ROSTER[hangar.index].id;
      transition(() => goFlight(id));
    } else if (input.take('back')) transition(goTitle);
  } else if (state === 'flight') {
    if (!paused && input.take('pause')) {
      setPaused(true);
      audio.uiMove();
    } else if (paused) {
      if (controlsUi.visible) {
        if (input.take('back') || input.take('confirm') || input.take('pause')) {
          controlsUi.show(false);
          pauseMenu.show(true);
        }
      } else {
        if (input.take('up')) {
          pauseMenu.move(-1);
          audio.uiMove();
        }
        if (input.take('down')) {
          pauseMenu.move(1);
          audio.uiMove();
        }
        if (input.take('confirm')) {
          audio.uiConfirm();
          pauseMenu.activate();
        } else if (input.take('back') || input.take('pause')) setPaused(false);
      }
    }
  }
  const keep = state === 'flight' && !paused ? ['camera', 'missile'] : [];
  for (const a of ['left', 'right', 'up', 'down', 'confirm', 'back', 'pause', 'camera', 'missile'] as const) if (!keep.includes(a)) while (input.take(a));
}

function flightSound(f: FlightMode): FlightSound {
  const p = f.player;
  const toCam = f.rig.camera.position.clone().sub(p.flight.pos);
  const d = toCam.length();
  const closing = d > 1 ? p.flight.vel.dot(toCam) / d : 0;
  const flyby = f.rig.mode === 'flyby';
  const lockProgress = f.weapons.locks.reduce((m, l) => Math.max(m, f.weapons.lockFraction(l)), 0);
  return {
    alive: p.alive,
    throttle: p.flight.throttle,
    boost: p.flight.boost,
    speed: p.flight.speed,
    cockpit: f.rig.mode === 'cockpit',
    flyby: flyby ? d : 0,
    doppler: flyby ? 343 / Math.max(120, 343 - closing * 0.6) : 1,
    shipProximity: Math.max(0, 1 - p.flight.pos.distanceTo(SHIP_CORE) / 2600),
    lock: lockProgress >= 1 ? 'locked' : lockProgress > 0 ? 'seeking' : 'none',
    pullUp: f.pullUp,
    pitch: p.spec.engine.pitch,
    roar: p.spec.engine.roar,
    wallLeft: f.walls[0],
    wallRight: f.walls[1],
  };
}

// Sounds from the city and the war beyond it, heard from wherever the camera is.
function worldAudioEvents() {
  const listener = state === 'hangar' && backdrop ? backdrop.listener : mode?.camera.position;
  if (!listener) return;
  for (const s of world.siege.sounds) audio.aaThump(s.pos.distanceTo(listener));
  for (const b of world.horizon.booms) {
    const delay = audio.distantBoom(b.distance, b.strength);
    if (state === 'hangar') window.setTimeout(() => state === 'hangar' && hangar?.rumble(b.strength * 0.6), delay * 1000);
  }
  const fire = world.siege.firePositions.reduce((m, p) => Math.max(m, 1 - p.distanceTo(listener) / 450), 0);
  audio.setFire(Math.pow(Math.max(fire, 0), 1.5));
}

function flightAudioEvents(f: FlightMode) {
  const cam = f.rig.camera.position;
  for (const e of f.weaponEvents) {
    if (e.kind === 'gun') audio.gun(e.gun);
    else if (e.kind === 'launch') audio.launch(e.special);
    else if (e.kind === 'charge') audio.charge();
    else if (e.size > 0) audio.explosion(e.pos.distanceTo(cam) / e.size);
  }
  for (const e of f.alienEvents) {
    if (e.kind === 'alienFire') audio.alienZap(e.pos.distanceTo(cam));
    else if (e.kind === 'alienDown') audio.explosion(e.pos.distanceTo(cam));
    else audio.hit();
  }
  for (const e of f.playerEvents) if (e.kind !== 'respawned') audio.explosion(0);
  if (f.radio.opened) audio.radio(true);
  if (f.radio.closed) audio.radio(false);
}

const fixedTime = params.has('t') ? Number(params.get('t')) : null;
let frames = 0;
let last = performance.now();
const t0 = last;

function frame(now: number) {
  const dt = fixedTime !== null ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = fixedTime ?? (now - t0) / 1000;
  const cpu0 = performance.now();
  renderer.gl.info.reset();
  input.update(dt);
  handleInput();
  if (state === 'hangar' && backdrop && hangar) {
    backdrop.update(dt, time);
    updatePointScale(hangar.camera, bufferHeight());
  }
  if (mode && !paused) mode.update(dt, time);
  if (flight && !paused) flightAudioEvents(flight);
  if (!paused) worldAudioEvents();
  audio.update(dt, time, flight && !paused ? flightSound(flight) : null);
  audio.setRain(world.weather.rain);
  const rainNow = state === 'hangar' ? 0 : world.weather.rain;
  renderer.setRain(rainNow, rainNow * (flight?.rig.mode === 'cockpit' ? 0.9 : 0.18));
  const thunder = world.weather.takeThunder();
  if (thunder) {
    audio.thunder(thunder);
    if (state === 'hangar') hangar?.rumble(thunder * 0.5);
  }
  renderer.setSpeedBlur(flight && !paused && flight.rig.mode !== 'flyby' ? flight.player.flight.boost * 0.25 : 0);
  renderer.rays.enabled = mode?.scene === world.scene;
  if (mode) renderer.render(mode.scene, mode.camera, time);
  if (params.has('shot')) {
    const info = renderer.gl.info.render;
    window.__stats = { calls: info.calls, tris: info.triangles, points: info.points, cpuMs: +(performance.now() - cpu0).toFixed(2) };
  }
  window.__frames = ++frames;
  if (frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}

if (params.has('shot')) window.__game = { get flight() { return flight; }, get world() { return world; }, renderer };

window.setTimeout(start, 30);
