import type * as THREE from 'three';

export interface JetAnimState {
  time: number;
  throttle: number;
  boost: number;
  speed: number;
  pitch: number;
  roll: number;
  yaw: number;
}

export interface JetModel {
  root: THREE.Group;
  nozzles: { pos: THREE.Vector3; r: number }[];
  wingtips: [THREE.Vector3, THREE.Vector3];
  guns: THREE.Vector3[];
  cockpit: THREE.Vector3;
  length: number;
  radius: number;
  animate?: (s: JetAnimState) => void;
}

export interface FlightSpec {
  cruise: number;
  max: number;
  min: number;
  accel: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  grip: number;
}

export type Loadout = 'standard' | 'volley' | 'rail' | 'flak' | 'orb';

export interface JetSpec {
  id: string;
  loadout?: Loadout;
  stats: { speed: number; handling: number; armour: number; weapons: number };
  flight: FlightSpec;
  engine: { pitch: number; roar: number; flame: [number, number, number] };
  build(): JetModel;
}

export function flightFromStats(speed: number, handling: number): FlightSpec {
  const cruise = 95 + speed * 9;
  return {
    cruise,
    max: cruise * 1.9,
    min: 55,
    accel: 22 + speed * 3,
    pitchRate: 0.462 + handling * 0.0616,
    rollRate: 1.5295 + handling * 0.2254,
    yawRate: 0.21 + handling * 0.0245,
    grip: 2.5 + handling * 0.35,
  };
}
