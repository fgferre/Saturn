/** Simulation clock: Julian Date driven by real time × a signed speed factor. */

import { dateToJD, jdToDate } from '../orbital/types.ts';

export class SimClock {
  /** Current simulation time as a Julian Date. */
  jd: number;
  /** Simulated seconds per real second (negative = backwards). */
  speed = 3600;
  paused = false;

  constructor(start = new Date()) {
    this.jd = dateToJD(start);
  }

  update(dtSeconds: number): void {
    if (this.paused) return;
    this.jd += (dtSeconds * this.speed) / 86400;
  }

  get date(): Date {
    return jdToDate(this.jd);
  }

  setNow(): void {
    this.jd = dateToJD(new Date());
  }
}
