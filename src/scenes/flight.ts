import * as THREE from 'three';
import { makeEnvironment } from '../core/env';
import { features } from '../core/features';
import type { Input } from '../core/input';
import { MOON_DIR } from '../core/atmosphere';
import { jetById } from '../aircraft/roster';
import { Aliens, type AlienEvent } from '../game/aliens';
import { CameraRig, CAMERA_MODES, type CameraMode } from '../game/cameraRig';
import { makeCanopy } from '../game/canopy';
import { Effects } from '../game/particles';
import { Player, type PlayerEvent } from '../game/player';
import { Radio } from '../game/radio';
import { Trail } from '../game/trails';
import { Weapons, type WeaponEvent } from '../game/weapons';
import { copy, fill } from '../ui/copy';
import { Hud, type HudState } from '../ui/hud';
import { SHIP_CORE } from '../world/mothership';
import type { World } from '../world/world';
import type { Mode } from './mode';

// Test params: pos=x,y,z  hdg=deg  bank=deg  freeze  cam=chase|cockpit|flyby  aggro  alienNear
export interface FlightMode extends Mode {
  player: Player;
  rig: CameraRig;
  aliens: Aliens;
  weapons: Weapons;
  playerEvents: PlayerEvent[];
  alienEvents: AlienEvent[];
  weaponEvents: WeaponEvent[];
  pullUp: boolean;
  // Nearness of a wall on the left and right, 0 to 1.
  walls: [number, number];
  radio: Radio;
}

export function flightMode(renderer: THREE.WebGLRenderer, world: World, input: Input, jetId: string, params: URLSearchParams, ui: HTMLElement): FlightMode {
  const scene = world.scene;
  scene.environment = makeEnvironment(renderer, {
    sky: 0x080c18,
    horizon: 0x3a261c,
    ground: 0x5a3316,
    spots: [{ dir: MOON_DIR, color: 0xdde6ff, size: 0.8 }],
  });
  scene.environmentIntensity = 0.7;

  const player = new Player(jetById(jetId));
  const effects = new Effects();
  const aliens = new Aliens();
  const weapons = new Weapons(player.spec.loadout);
  const hud = new Hud(ui);
  const trails = [new Trail(), new Trail()];
  const tip = new THREE.Vector3();
  const canopy = features.canopy && player.spec.id !== 'alien' ? makeCanopy(player.model.cockpit) : null;
  if (canopy) {
    canopy.traverse((o) => o.layers.set(1));
    player.root.add(canopy);
  }
  scene.add(player.root, effects.group, aliens.group, weapons.group, ...trails.map((t) => t.mesh));

  const pos = params.get('pos')?.split(',').map(Number);
  const hdg = params.has('hdg') ? THREE.MathUtils.degToRad(Number(params.get('hdg'))) : null;
  const start = pos ? new THREE.Vector3(pos[0], pos[1], pos[2]) : new THREE.Vector3(-2600, 230, 2300);
  const dir = hdg !== null ? new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg)) : new THREE.Vector3(-start.x, 0, -start.z).normalize();
  player.spawn(start, dir, Number(params.get('bank') ?? 0));
  if (params.has('aggro')) for (const f of aliens.fighters) aliens.provoke(f);
  if (params.has('alienNear')) {
    aliens.fighters.slice(0, 3).forEach((a, i) => {
      a.pos.copy(start).addScaledVector(dir, 90 + i * 30).add(new THREE.Vector3(-14 + i * 16, 6 + i * 5, 0));
      a.fwd.copy(dir);
    });
  }

  aliens.group.traverse((o) => o.layers.set(1));
  const rig = new CameraRig();
  rig.camera.layers.enable(1);
  const camParam = params.get('cam') as CameraMode | null;
  if (camParam && CAMERA_MODES.includes(camParam)) rig.mode = camParam;
  rig.snap(player.flight);
  const frozen = params.has('freeze');
  const size = new THREE.Vector2();
  const playerEvents: PlayerEvent[] = [];
  const alienEvents: AlienEvent[] = [];
  const weaponEvents: WeaponEvent[] = [];
  let eventText: string | null = null;
  const aim = new THREE.Vector3();
  const probe = new THREE.Vector3();

  const hudState: HudState = {
    mode: 'chase',
    speed: 0,
    altitude: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    boostFuel: 1,
    boosting: false,
    health: 100,
    weapon: { text: '', ready: true },
    kills: 0,
    aim: null,
    locks: [],
    lockCount: null,
    radar: { px: 0, pz: 0, heading: 0, aliens: [] },
    pullUp: false,
    turnBack: false,
    event: null,
    countdown: null,
    radio: null,
  };
  const radio = new Radio();
  let wasNearShip = false;
  let wasRaining = world.weather.rain > 0.5;

  const mode: FlightMode = {
    scene,
    camera: rig.camera,
    player,
    rig,
    aliens,
    weapons,
    playerEvents,
    alienEvents,
    weaponEvents,
    pullUp: false,
    walls: [0, 0],
    radio,
    update(dt, time) {
      playerEvents.length = 0;
      alienEvents.length = 0;
      weaponEvents.length = 0;
      const c = input.controls;
      if (input.take('camera')) rig.cycle();
      const fireSpecial = input.take('missile');

      const pe = player.update(dt, c, time, world, effects, frozen);
      if (pe) playerEvents.push(pe);
      aliens.update(dt, time, player, world, effects, alienEvents);
      const fromWeapons = alienEvents.length;
      weapons.update(dt, c, fireSpecial, player, aliens, world, effects, alienEvents, weaponEvents);
      if (alienEvents.slice(fromWeapons).some((e) => e.kind === 'alienDown')) radio.trigger('kill');
      if (alienEvents.some((e) => e.kind === 'playerHit')) radio.trigger('hit');
      for (const ev of alienEvents) {
        if (ev.kind === 'playerHit') {
          rig.shake = Math.max(rig.shake, 0.15);
          const r = player.damage(ev.amount, effects);
          if (r) playerEvents.push(r);
        } else if (ev.kind === 'alienDown') weapons.kills++;
      }
      for (const ev of playerEvents) {
        if (ev.kind === 'respawned') {
          rig.snap(player.flight);
          for (const t of trails) t.reset();
          weapons.reset();
          eventText = null;
          radio.trigger('respawn');
        } else {
          rig.shake = 0.6;
          eventText = ev.kind === 'crashed' ? copy.events.crashed : copy.events.shotDown;
        }
      }
      effects.update(dt);

      const f = player.flight;
      const vapour = player.alive ? THREE.MathUtils.clamp((f.gLoad - 2.5) / 5, 0, 1) : 0;
      trails.forEach((t, i) => t.update(dt, tip.copy(player.model.wingtips[i]).applyQuaternion(f.quat).add(f.pos), vapour, rig.camera));
      rig.update(dt, f, player.model.length, player.model.cockpit, c.lookX, c.lookY, player.spec.flight.max, player.spec.flight.cruise);
      player.model.root.visible = rig.mode !== 'cockpit' && player.alive;
      if (canopy) canopy.visible = rig.mode === 'cockpit' && player.alive;
      renderer.getDrawingBufferSize(size);
      world.update(dt, time, rig.camera, size.y);

      let pullUp = false;
      if (player.alive) {
        for (const t of [0.6, 1.2, 1.8, 2.4]) {
          if (world.collision.hit(probe.copy(f.pos).addScaledVector(f.vel, t), 3)) {
            pullUp = true;
            break;
          }
        }
      }
      mode.walls[0] = mode.walls[1] = 0;
      if (player.alive) {
        for (const [i, side] of [
          [0, -1],
          [1, 1],
        ] as const) {
          for (const d of [10, 20, 32, 45]) {
            if (world.collision.hit(probe.copy(f.pos).addScaledVector(f.right, side * d), 2)) {
              mode.walls[i] = 1 - d / 55;
              break;
            }
          }
        }
      }
      hudState.mode = rig.mode;
      hudState.speed = f.speed;
      hudState.altitude = Math.max(0, f.pos.y);
      hudState.heading = Math.atan2(f.fwd.x, -f.fwd.z);
      hudState.pitch = Math.asin(Math.max(-1, Math.min(1, f.fwd.y)));
      hudState.roll = Math.atan2(-f.right.y, f.up.y);
      hudState.boostFuel = player.boostFuel;
      hudState.health = player.health;
      const name = copy.weapons[weapons.special].name;
      hudState.weapon.ready = weapons.ready;
      hudState.weapon.text = fill(weapons.charging > 0 ? copy.hud.weaponCharging : weapons.ready ? copy.hud.weaponReady : copy.hud.weaponReloading, name, 'weapon');
      hudState.kills = weapons.kills;
      hudState.aim = player.alive ? aim.copy(f.pos).addScaledVector(f.fwd, 600) : null;
      hudState.locks = player.alive ? weapons.locks.map((l) => ({ pos: l.target.pos, progress: weapons.lockFraction(l) })) : [];
      hudState.lockCount = weapons.special === 'volley' ? weapons.locked.length : null;
      hudState.radar.px = f.pos.x;
      hudState.radar.pz = f.pos.z;
      hudState.radar.heading = hudState.heading;
      hudState.radar.aliens = aliens.fighters.filter((a) => a.alive).map((a) => ({ x: a.pos.x, z: a.pos.z, hot: aliens.isAggro(a) }));
      hudState.pullUp = pullUp;
      mode.pullUp = pullUp;
      hudState.turnBack = f.outOfBounds;
      hudState.event = player.alive ? null : eventText;
      hudState.countdown = player.alive ? null : Math.max(1, Math.ceil(player.respawnIn));

      const nearShip = f.pos.distanceTo(SHIP_CORE) < 1200;
      if (nearShip && !wasNearShip) radio.trigger('nearShip');
      wasNearShip = nearShip;
      const raining = world.weather.rain > 0.5;
      if (raining && !wasRaining) radio.trigger('rain');
      wasRaining = raining;
      if (world.siege.blackoutStarted) radio.trigger('blackout');
      radio.update(dt);
      hudState.radio = radio.current ? { label: radio.current.label, text: radio.current.text, alpha: radio.alpha } : null;
      hud.draw(hudState, rig.camera, time);
    },
    dispose() {
      hud.canvas.remove();
      scene.remove(player.root, effects.group, aliens.group, weapons.group, ...trails.map((t) => t.mesh));
    },
  };
  return mode;
}
