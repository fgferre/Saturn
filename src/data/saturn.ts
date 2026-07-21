/**
 * Saturn system data. Sources: NASA/JPL SSD (ssd.jpl.nasa.gov) planetary
 * satellite mean elements and physical parameters; ring radii from Cassini
 * (PDS Ring-Moon Systems Node).
 *
 * Moon elements are mean elements referred to Saturn's equatorial plane
 * (≈ local Laplace plane for the inner moons; Iapetus' Laplace plane tilt is
 * folded into its inclination). Node/periapsis precession is neglected —
 * positions are accurate at the "mean elements" level, which is what a
 * visual real-time simulation needs.
 */

import { J2000, type BodyDefinition } from '../orbital/types.ts';

/** Scene unit: 1 unit = 1000 km. */
export const KM_PER_UNIT = 1000;

export const SATURN: BodyDefinition = {
  id: 'saturn',
  name: 'Saturn',
  physical: {
    radiusKm: 60268,
    polarRadiusKm: 54364,
    rotationPeriodH: 10.561, // System III
  },
  blurb: 'Sixth planet from the Sun, second largest in the Solar System. Its rings span 280,000 km yet average only ~10 m thick.',
};

export const MOONS: BodyDefinition[] = [
  {
    id: 'mimas',
    name: 'Mimas',
    physical: { radiusKm: 198.2, tidallyLocked: true },
    elements: { aKm: 185539, e: 0.0196, iDeg: 1.574, nodeDeg: 173.0, periDeg: 332.5, m0Deg: 14.8, periodDays: 0.9424218, epochJD: J2000 },
    blurb: 'The "Death Star moon" — the 130 km crater Herschel dominates its face. Smallest body known to be rounded by its own gravity.',
  },
  {
    id: 'enceladus',
    name: 'Enceladus',
    physical: { radiusKm: 252.1, tidallyLocked: true },
    elements: { aKm: 238042, e: 0.0047, iDeg: 0.009, nodeDeg: 342.5, periDeg: 216.3, m0Deg: 197.0, periodDays: 1.370218, epochJD: J2000 },
    blurb: 'An ice world venting water from a subsurface ocean. Over 100 geysers erupt from its south-polar "tiger stripes", feeding Saturn\'s E ring.',
  },
  {
    id: 'tethys',
    name: 'Tethys',
    physical: { radiusKm: 531.1, tidallyLocked: true },
    elements: { aKm: 294672, e: 0.0001, iDeg: 1.091, nodeDeg: 259.8, periDeg: 45.2, m0Deg: 243.4, periodDays: 1.8878026, epochJD: J2000 },
    blurb: 'Almost pure water ice. Scarred by the 400 km crater Odysseus and Ithaca Chasma, a canyon running 3/4 of the way around the moon.',
  },
  {
    id: 'dione',
    name: 'Dione',
    physical: { radiusKm: 561.4, tidallyLocked: true },
    elements: { aKm: 377415, e: 0.0022, iDeg: 0.028, nodeDeg: 290.4, periDeg: 284.0, m0Deg: 322.2, periodDays: 2.7369152, epochJD: J2000 },
    blurb: 'Ice cliffs hundreds of meters tall streak its trailing hemisphere — the "wispy terrain" revealed by Cassini as vast tectonic fractures.',
  },
  {
    id: 'rhea',
    name: 'Rhea',
    physical: { radiusKm: 763.8, tidallyLocked: true },
    elements: { aKm: 527068, e: 0.001, iDeg: 0.333, nodeDeg: 351.0, periDeg: 241.6, m0Deg: 179.8, periodDays: 4.5175, epochJD: J2000 },
    blurb: 'Saturn\'s second-largest moon, a heavily cratered ice ball. May once have had its own faint ring system.',
  },
  {
    id: 'titan',
    name: 'Titan',
    physical: { radiusKm: 2574.7, tidallyLocked: true },
    elements: { aKm: 1221865, e: 0.0288, iDeg: 0.306, nodeDeg: 28.1, periDeg: 180.5, m0Deg: 163.3, periodDays: 15.9454484, epochJD: J2000 },
    blurb: 'Larger than Mercury, with a nitrogen atmosphere denser than Earth\'s. Methane rains onto hydrocarbon seas beneath the orange haze.',
  },
  {
    id: 'hyperion',
    name: 'Hyperion',
    physical: { radiusKm: 135, tidallyLocked: false },
    elements: { aKm: 1481500, e: 0.105, iDeg: 0.43, nodeDeg: 263.8, periDeg: 303.0, m0Deg: 86.3, periodDays: 21.2766088, epochJD: J2000 },
    blurb: 'A sponge-like rubble pile tumbling chaotically — the only known moon with no fixed rotation. Its odd spin is driven by Titan\'s pull.',
  },
  {
    id: 'iapetus',
    name: 'Iapetus',
    physical: { radiusKm: 734.5, tidallyLocked: true },
    // Inclination here is relative to Saturn's equator (its Laplace plane is tilted).
    elements: { aKm: 3560854, e: 0.0293, iDeg: 15.47, nodeDeg: 81.1, periDeg: 271.6, m0Deg: 201.3, periodDays: 79.3210771, epochJD: J2000 },
    blurb: 'The two-faced moon: one hemisphere is coal-dark, the other bright ice. A 13 km-high equatorial ridge girds a third of the moon.',
  },
];

/** Ring radii in km (Cassini/PDS). Used by geometry and the profile texture. */
export const RINGS = {
  innerKm: 66900, // D ring inner edge
  outerKm: 140500, // just past the F ring
  regions: {
    d: [66900, 74510],
    c: [74658, 91975],
    maxwellGap: [87342, 87610],
    b: [91975, 117507],
    cassini: [117507, 122340],
    a: [122340, 136780],
    enckeGap: [133423, 133745],
    keelerGap: [136485, 136522],
    f: [140000, 140420],
  } as Record<string, [number, number]>,
};

/**
 * Saturn heliocentric mean elements (J2000, ecliptic frame) — used only to
 * compute the Sun's direction (seasons, ring shadow geometry).
 */
export const SATURN_HELIOCENTRIC = {
  aKm: 9.53707032 * 149597870.7,
  e: 0.05415060,
  iDeg: 2.48446,
  nodeDeg: 113.71504,
  periDeg: 92.43194 - 113.71504, // longitude of perihelion minus node
  m0Deg: 49.94432 - 92.43194, // mean longitude minus longitude of perihelion
  periodDays: 10759.22,
  epochJD: J2000,
};

/** Saturn's north pole, ICRF right ascension / declination, degrees (IAU). */
export const SATURN_POLE = { raDeg: 40.589, decDeg: 83.537 };

/**
 * Phoebe's orbit orientation as JPL SSD publishes it — in the ECLIPTIC frame
 * (i > 90° ⇒ retrograde). Kept as the documented source for the equatorial
 * conversion below; `wave7.selfcheck.ts` re-runs eclipticOrbitToSaturnFrame()
 * on these numbers and asserts the MINOR_MOONS entry matches (gotcha §15).
 * ⚠ VERIFICAR: JPL SSD irregular-satellite mean elements (J2000 ecliptic).
 */
export const PHOEBE_ECLIPTIC = { iDeg: 173.04, nodeDeg: 241.57, periDeg: 342.47 };

/**
 * Minor moons + Phoebe (F11.1). Kept SEPARATE from MOONS so they claim no
 * in-shader shadow slot — MOON_SHADOW_COUNT stays 8 (the 8 majors). They still
 * receive `eclipseLight` (darken/redden in the umbra) and draw orbit lines.
 *
 * Inner moons (Pan…Epimetheus): near-circular, near-equatorial, so e≈0 / i≈0 /
 * node = peri = 0 are valid approximations; periods are the published sidereal
 * values (JPL SSD), consistent with Kepler's third law about Saturn's GM.
 * Rotation is synchronous (tidally locked).
 *
 * Janus/Epimetheus are a co-orbital pair (Δa ≈ 50 km < their summed radii).
 * DECISION (b, plan §8): give them EQUAL periods — a co-rotating pair with a
 * fixed longitude separation — so the meshes never interpenetrate. The real
 * ~4-yr orbit swap is out of scope (§12). Epimetheus carries a nominal fixed
 * m0 offset so the two sit apart. ⚠ VERIFICAR: separation is nominal, not an
 * ephemeris; epoch pinned at J2000.
 *
 * Phoebe: irregular, retrograde, non-synchronous 9.27 h spin, very dark
 * (albedo ~0.08). Its i/node/peri are the frame-converted equatorial values
 * (from PHOEBE_ECLIPTIC via eclipticOrbitToSaturnFrame); a/e/M0/period are
 * frame-independent. Apoapsis a(1+e) ≈ 15,070 units < ORBIT_MAX_DISTANCE.
 */
export const MINOR_MOONS: BodyDefinition[] = [
  {
    id: 'pan',
    name: 'Pan',
    physical: { radiusKm: 14, tidallyLocked: true },
    elements: { aKm: 133584, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.5750, epochJD: J2000 },
    blurb: 'The "flying saucer" moon that clears the Encke Gap in the A ring, its equatorial ridge swept up from ring material.',
  },
  {
    id: 'daphnis',
    name: 'Daphnis',
    physical: { radiusKm: 3.8, tidallyLocked: true },
    elements: { aKm: 136505, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.5940, epochJD: J2000 },
    blurb: 'A tiny moon in the Keeler Gap whose gravity raises vertical waves on the gap edges, casting shadows near equinox.',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    physical: { radiusKm: 15, tidallyLocked: true },
    elements: { aKm: 137670, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.6017, epochJD: J2000 },
    blurb: 'A ravioli-shaped shepherd just outside the A ring, girdled by a smooth equatorial ridge of accreted ring particles.',
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    physical: { radiusKm: 43, tidallyLocked: true },
    elements: { aKm: 139380, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.6130, epochJD: J2000 },
    blurb: 'The inner shepherd of the F ring — its passes draw dark "streamer-channels" out of the ring every orbit.',
  },
  {
    id: 'pandora',
    name: 'Pandora',
    physical: { radiusKm: 40, tidallyLocked: true },
    elements: { aKm: 141720, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.6285, epochJD: J2000 },
    blurb: 'The outer shepherd of the F ring, a heavily cratered body that helps confine the ring\'s bright core strand.',
  },
  {
    id: 'janus',
    name: 'Janus',
    physical: { radiusKm: 89, tidallyLocked: true },
    elements: { aKm: 151460, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 0, periodDays: 0.6945, epochJD: J2000 },
    blurb: 'The larger of the co-orbital twins. Every ~4 years it swaps orbits with Epimetheus in a gravitational dance.',
  },
  {
    id: 'epimetheus',
    name: 'Epimetheus',
    // Equal period to Janus (co-rotating pair); a nominal 60° m0 offset keeps
    // the twins apart in longitude instead of interpenetrating.
    physical: { radiusKm: 58, tidallyLocked: true },
    elements: { aKm: 151410, e: 0, iDeg: 0, nodeDeg: 0, periDeg: 0, m0Deg: 60, periodDays: 0.6945, epochJD: J2000 },
    blurb: 'The smaller co-orbital twin, sharing an orbit with Janus barely 50 km apart — closer than either moon is wide.',
  },
  {
    id: 'phoebe',
    name: 'Phoebe',
    physical: { radiusKm: 106.5, rotationPeriodH: 9.27, tidallyLocked: false },
    // Equatorial-frame i/node/peri converted from PHOEBE_ECLIPTIC (gotcha §15).
    // i = 149.14° ⇒ retrograde (kepler propagates i > 90° as clockwise seen
    // from +Y). e/period from JPL SSD (⚠ VERIFICAR).
    elements: { aKm: 12952000, e: 0.1635, iDeg: 149.14266, nodeDeg: 52.95355, periDeg: 281.75182, m0Deg: 0, periodDays: 550.31, epochJD: J2000 },
    blurb: 'A dark, retrograde captured body — likely a Kuiper-belt refugee. It orbits backwards, tilted far from the ring plane, once every ~18 months.',
  },
];
