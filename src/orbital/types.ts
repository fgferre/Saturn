/**
 * Framework-agnostic orbital/body definitions.
 * Designed so a future full Solar System simulator can reuse this module:
 * any body is defined by physical properties + Keplerian elements relative
 * to a parent frame (planet equatorial frame for moons, ecliptic for planets).
 */

/** Keplerian mean elements at a reference epoch. Angles in degrees. */
export interface OrbitalElements {
  /** Semi-major axis, in kilometers. */
  aKm: number;
  /** Eccentricity. */
  e: number;
  /** Inclination to the parent reference plane, degrees. */
  iDeg: number;
  /** Longitude of the ascending node, degrees. */
  nodeDeg: number;
  /** Argument of periapsis, degrees. */
  periDeg: number;
  /** Mean anomaly at epoch, degrees. */
  m0Deg: number;
  /** Orbital period, days. */
  periodDays: number;
  /** Reference epoch as Julian Date (TDB ~ UTC for our purposes). */
  epochJD: number;
}

export interface BodyPhysical {
  /** Mean/equatorial radius, km. */
  radiusKm: number;
  /** Polar radius, km (defaults to radiusKm when absent). */
  polarRadiusKm?: number;
  /** Sidereal rotation period in hours. Negative = retrograde. */
  rotationPeriodH?: number;
  /** Synchronous rotation (tidally locked to parent). */
  tidallyLocked?: boolean;
}

export interface BodyDefinition {
  id: string;
  name: string;
  physical: BodyPhysical;
  /** Absent for the system's primary body. */
  elements?: OrbitalElements;
  /** Short human-readable description for the info panel. */
  blurb?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const J2000 = 2451545.0;
export const DAY_MS = 86400_000;

/** Julian Date from a JS Date (UTC). */
export function dateToJD(date: Date): number {
  return date.getTime() / DAY_MS + 2440587.5;
}

/** JS Date from a Julian Date. */
export function jdToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * DAY_MS);
}
