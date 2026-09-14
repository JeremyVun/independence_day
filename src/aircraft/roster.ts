import { alien } from './jets/alien';
import { f117 } from './jets/f117';
import { f14 } from './jets/f14';
import { f16 } from './jets/f16';
import { f18 } from './jets/f18';
import { f22 } from './jets/f22';
import { mig29 } from './jets/mig29';
import { protoA } from './jets/protoA';
import { protoB } from './jets/protoB';
import { protoC } from './jets/protoC';
import { sr71 } from './jets/sr71';
import type { JetSpec } from './types';

export const ROSTER: JetSpec[] = [f22, f16, f18, f14, mig29, f117, sr71, protoA, protoB, protoC, alien];

export const jetById = (id: string | null | undefined): JetSpec => ROSTER.find((j) => j.id === id) ?? ROSTER[0];
