/** DOM HUD: time controls, body selector, info panel. No framework needed. */

import './hud.css';
import { dateToJD, jdToDate, J2000, type BodyDefinition } from '../orbital/types.ts';
import { PRESETS, quality, setQuality, type QualityName } from '../core/quality.ts';
import { FOV_DEFAULT, FOV_MAX, FOV_MIN } from '../core/urlState.ts';
import type { SaturnEvent } from '../data/events.ts';

/** Date-picker validity window — J2000 ± 200 Julian years (matches urlState). */
const JD_HALF_SPAN = 200 * 365.25;
const JD_MIN = J2000 - JD_HALF_SPAN;
const JD_MAX = J2000 + JD_HALF_SPAN;

export interface HudCallbacks {
  onFocus(id: string): void;
  onSpeed(speed: number): void;
  onPause(paused: boolean): void;
  onNow(): void;
  onToggleOrbits(v: boolean): void;
  onToggleLabels(v: boolean): void;
  onToggleDrift(v: boolean): void;
  onExposure(v: number): void;
  /** Change the camera field of view (degrees, telephoto ↔ wide). */
  onFov(v: number): void;
  onCinema(): void;
  /** Capture + download a high-res PNG; the button stays disabled until it settles. */
  onPhoto(): void | Promise<void>;
  /**
   * Record + download a ~10 s WebM of the canvas; resolves when the file is
   * saved. Optional — omitted (and the button hidden) when the browser can't
   * capture the canvas or encode WebM.
   */
  onRecord?(): void | Promise<void>;
  /** Apply a user-entered simulation time (Julian Date, already validated). */
  onDate(jd: number): void;
  /** Flush the shareable URL and return `location.href` to copy / share. */
  onShare(): string;
}

/** A labelled section of the body selector (e.g. "Major" / "Minor"). */
export interface BodyGroup {
  label: string;
  bodies: BodyDefinition[];
}

/** Live, camera-relative readouts refreshed a couple times a second. */
export interface LiveInfo {
  distanceKm?: number;
  /** Apparent angular diameter, degrees. */
  apparentDeg?: number;
  /** Sun–body–camera phase angle, degrees (0 = full, 180 = new). */
  phaseDeg?: number;
  /** Fraction of sunlight reaching the body (0–100), umbra/ring shadow. */
  sunlightPct?: number;
}

/** HUD date readout: `YYYY-MM-DD  HH:MM:SS UTC`. */
function fmtDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', '  ') + ' UTC';
}

/** Compact event date: `YYYY-MM-DD HH:MM`. */
function fmtEventDate(jd: number): string {
  return jdToDate(jd).toISOString().slice(0, 16).replace('T', ' ');
}

/** One-glyph category tag for the event list. */
const EVENT_ICON: Record<SaturnEvent['category'], string> = {
  equinox: '⊙',
  solstice: '☀',
  opposition: '◆',
  'titan-transit': '◐',
  apoapsis: '❂',
};

/** Angular size in the most readable unit. */
function fmtAngle(deg: number): string {
  if (deg >= 1) return `${deg.toFixed(1)}°`;
  if (deg >= 1 / 60) return `${(deg * 60).toFixed(1)}′`;
  return `${(deg * 3600).toFixed(1)}″`;
}

const SPEEDS: { label: string; value: number }[] = [
  { label: '-1 d/s', value: -86400 },
  { label: '-1 h/s', value: -3600 },
  { label: '1×', value: 1 },
  { label: '1 min/s', value: 60 },
  { label: '1 h/s', value: 3600 },
  { label: '6 h/s', value: 21600 },
  { label: '1 d/s', value: 86400 },
  { label: '5 d/s', value: 432000 },
];

/** Default active preset (matches SimClock's initial speed). */
const DEFAULT_SPEED = 3600;

/** Ordered preset values — shared with the keyboard `[`/`]` speed stepper. */
export const SPEED_VALUES: number[] = SPEEDS.map((s) => s.value);

/**
 * Single source of truth for the help overlay AND the first-visit hint. The
 * global keyboard handler in main.ts owns the actual key bindings; this list
 * only documents them so the two never drift.
 */
const KEY_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Space', label: 'Pause / resume' },
  { keys: '[  ]', label: 'Slower / faster' },
  { keys: 'H', label: 'Hide the HUD' },
  { keys: 'F', label: 'Fullscreen' },
  { keys: '?', label: 'This help' },
  { keys: 'Esc', label: 'Close help / exit cinema' },
];
const POINTER_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Drag', label: 'Orbit' },
  { keys: 'Scroll', label: 'Zoom in / out' },
  { keys: 'Click', label: 'Focus a body' },
];

/** localStorage flag: the first-visit hint shows once, then never again. */
const HINT_KEY = 'saturn.hinted';

export class Hud {
  private readonly dateEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly dprEl: HTMLElement;
  private readonly infoName: HTMLElement;
  private readonly infoBlurb: HTMLElement;
  private readonly infoStats: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly eventsListEl: HTMLElement;
  /** The recurring "next apoapsis" row, refreshed as sim time advances. */
  private apoapsisRow?: HTMLButtonElement;
  private apoapsisEvent?: SaturnEvent;
  private onEventJump: (e: SaturnEvent) => void = () => {};
  private readonly bodyButtons = new Map<string, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private pauseBtn!: HTMLButtonElement;
  private fovInput!: HTMLInputElement;
  private readonly helpEl: HTMLElement;
  private paused = false;
  /** True while the date readout is swapped for its editor (don't clobber it). */
  private editing = false;
  /** Latest simulated date pushed via setDate — the editor prefills from it. */
  private lastDate = new Date();
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(groups: BodyGroup[], backend: string, cb: HudCallbacks) {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.appendChild(hud);

    // Transient toast (e.g. "Link copied"), reused across shows.
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'hud-toast';
    this.toastEl.setAttribute('role', 'status');
    hud.appendChild(this.toastEl);

    // Brand.
    const brand = document.createElement('div');
    brand.className = 'panel hud-brand';
    brand.innerHTML = `<h1>SATURN</h1><div class="sub"><span class="hud-badge">${backend}</span><span class="fps"></span><span class="dpr" title="Dynamic render resolution (F10.3)"></span></div>`;
    hud.appendChild(brand);
    this.fpsEl = brand.querySelector('.fps')!;
    this.dprEl = brand.querySelector('.dpr')!;

    // Body list, split into labelled sections (Major / Minor). The panel
    // already scrolls (hud.css .hud-bodies overflow-y) for the longer list.
    const list = document.createElement('div');
    list.className = 'panel hud-bodies';
    for (const group of groups) {
      const header = document.createElement('div');
      header.className = 'hud-bodies-header';
      header.textContent = group.label;
      list.appendChild(header);
      for (const def of group.bodies) {
        const btn = document.createElement('button');
        btn.textContent = def.name;
        btn.addEventListener('click', () => cb.onFocus(def.id));
        list.appendChild(btn);
        this.bodyButtons.set(def.id, btn);
      }
    }
    hud.appendChild(list);

    // Time bar.
    const bar = document.createElement('div');
    bar.className = 'panel hud-time';
    hud.appendChild(bar);

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.textContent = '⏸';
    this.pauseBtn.title = 'Pause / resume simulation';
    this.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseBtn.textContent = this.paused ? '▶' : '⏸';
      cb.onPause(this.paused);
    });
    bar.appendChild(this.pauseBtn);

    // Date readout doubles as a picker: click (or Enter/Space) swaps it for a
    // datetime-local editor. Enter applies, Esc/blur cancels.
    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
    this.dateEl.tabIndex = 0;
    this.dateEl.setAttribute('role', 'button');
    this.dateEl.title = 'Click to set a date (UTC)';
    const openDateEditor = (): void => {
      if (this.editing) return;
      this.editing = true;
      const input = document.createElement('input');
      input.type = 'datetime-local';
      input.step = '1';
      input.className = 'date-input';
      input.min = '1800-01-01T00:00:00';
      input.max = '2200-01-01T00:00:00';
      // Prefill from the current sim time. The widget interprets the value as
      // LOCAL wall-clock, but the HUD works in UTC — see commit() below.
      input.value = this.lastDate.toISOString().slice(0, 19);
      this.dateEl.textContent = '';
      this.dateEl.appendChild(input);
      input.focus();
      const cancel = (): void => {
        if (!this.editing) return;
        this.editing = false;
        this.dateEl.textContent = fmtDate(this.lastDate);
      };
      const commit = (): void => {
        if (!this.editing) return;
        // datetime-local yields a LOCAL wall-clock string; force UTC with 'Z'
        // so the HUD's UTC readout round-trips.
        const d = new Date(`${input.value}Z`);
        const jd = Number.isNaN(d.getTime()) ? NaN : dateToJD(d);
        if (Number.isFinite(jd) && jd >= JD_MIN && jd <= JD_MAX) {
          this.editing = false;
          this.dateEl.textContent = fmtDate(d);
          cb.onDate(jd);
        } else {
          cancel(); // empty / unparseable / out of range: revert
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        e.stopPropagation(); // keep global shortcuts out of the field
      });
      input.addEventListener('blur', cancel);
    };
    this.dateEl.addEventListener('click', openDateEditor);
    this.dateEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openDateEditor();
      }
    });
    bar.appendChild(this.dateEl);

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));

    for (const s of SPEEDS) {
      const btn = document.createElement('button');
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        cb.onSpeed(s.value);
        this.speedButtons.forEach((b) => b.classList.toggle('active', b === btn));
      });
      bar.appendChild(btn);
      this.speedButtons.push(btn);
    }
    // Default: 1 h/s.
    this.setSpeed(DEFAULT_SPEED);

    bar.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
    const nowBtn = document.createElement('button');
    nowBtn.textContent = 'Now';
    nowBtn.title = 'Jump to the current real date';
    nowBtn.addEventListener('click', () => cb.onNow());
    bar.appendChild(nowBtn);

    // Info panel.
    const info = document.createElement('div');
    info.className = 'panel hud-info';
    info.innerHTML = `<h2></h2><div class="blurb"></div><div class="stats"></div>
      <div class="hud-toggles">
        <label><input type="checkbox" data-t="orbits">Orbits</label>
        <label><input type="checkbox" checked data-t="labels">Labels</label>
        <label><input type="checkbox" data-t="drift">Drift</label>
      </div>
      <div class="hud-exposure">
        <span>EV</span>
        <input type="range" min="0.5" max="2.6" step="0.05" value="1.4" data-t="exposure">
      </div>
      <div class="hud-exposure">
        <span>FOV</span>
        <input type="range" min="${FOV_MIN}" max="${FOV_MAX}" step="1" value="${FOV_DEFAULT}" data-t="fov">
      </div>
      <div class="hud-quality">
        <span>Quality</span>
        <div class="hud-quality-btns"></div>
        <button type="button" class="hud-cinema" title="Cinematic tour (Esc exits)">✦ Cinema</button>
      </div>
      <div class="hud-actions">
        <button type="button" class="hud-photo" title="Save a sharp 1920px PNG of the current view">📷 Photo</button>
        <button type="button" class="hud-record" title="Record a 10-second WebM video of the current view">⏺ Record 10s</button>
        <button type="button" class="hud-share" title="Copy a shareable link to this exact view">🔗 Share</button>
      </div>`;
    hud.appendChild(info);
    this.infoName = info.querySelector('h2')!;
    this.infoBlurb = info.querySelector('.blurb')!;
    this.infoStats = info.querySelector('.stats')!;
    info.querySelector<HTMLInputElement>('input[data-t="orbits"]')!
      .addEventListener('change', (e) => cb.onToggleOrbits((e.target as HTMLInputElement).checked));
    info.querySelector<HTMLInputElement>('input[data-t="labels"]')!
      .addEventListener('change', (e) => cb.onToggleLabels((e.target as HTMLInputElement).checked));
    info.querySelector<HTMLInputElement>('input[data-t="drift"]')!
      .addEventListener('change', (e) => cb.onToggleDrift((e.target as HTMLInputElement).checked));
    info.querySelector<HTMLInputElement>('input[data-t="exposure"]')!
      .addEventListener('input', (e) => cb.onExposure(Number((e.target as HTMLInputElement).value)));
    this.fovInput = info.querySelector<HTMLInputElement>('input[data-t="fov"]')!;
    this.fovInput.addEventListener('input', (e) => cb.onFov(Number((e.target as HTMLInputElement).value)));

    const qBtns = info.querySelector('.hud-quality-btns')!;
    for (const name of ['low', 'med', 'high', 'ultra'] as QualityName[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = PRESETS[name].label;
      if (quality.name === name) b.classList.add('active');
      b.addEventListener('click', () => { if (name !== quality.name) setQuality(name); });
      qBtns.appendChild(b);
    }
    info.querySelector<HTMLButtonElement>('.hud-cinema')!
      .addEventListener('click', () => cb.onCinema());

    // Photo: disable the button for the whole async capture so a second click
    // can't race the in-flight frame freeze (Engine.capture already guards the
    // loop, but the disabled state also signals "working" to the user).
    const photoBtn = info.querySelector<HTMLButtonElement>('.hud-photo')!;
    photoBtn.addEventListener('click', async () => {
      if (photoBtn.disabled) return;
      photoBtn.disabled = true;
      const label = photoBtn.textContent;
      photoBtn.textContent = 'Saving…';
      try {
        await cb.onPhoto();
      } catch (err) {
        console.error('photo capture failed', err);
      } finally {
        photoBtn.textContent = label;
        photoBtn.disabled = false;
      }
    });

    // Record: capture a fixed-length WebM of the live canvas. Photo and Record
    // are mutually disabled while a recording runs (the photo path freezes the
    // frame loop, which would stall the video). Drop the button entirely when
    // the host can't record (onRecord omitted after feature-detection).
    const recordBtn = info.querySelector<HTMLButtonElement>('.hud-record')!;
    if (cb.onRecord) {
      recordBtn.addEventListener('click', async () => {
        if (recordBtn.disabled) return;
        recordBtn.disabled = true;
        photoBtn.disabled = true;
        const label = recordBtn.textContent;
        recordBtn.textContent = 'Recording…';
        try {
          await cb.onRecord!();
        } catch (err) {
          console.error('video recording failed', err);
        } finally {
          recordBtn.textContent = label;
          recordBtn.disabled = false;
          photoBtn.disabled = false;
        }
      });
    } else {
      recordBtn.remove();
    }

    // Share: flush the throttled URL, then hand the link to the OS share sheet
    // (mobile) or the clipboard (desktop). Both can reject — a dismissed share
    // sheet throws AbortError, clipboard needs a secure context — so swallow.
    const shareBtn = info.querySelector<HTMLButtonElement>('.hud-share')!;
    shareBtn.addEventListener('click', async () => {
      const url = cb.onShare();
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: 'Saturn', url });
        } else {
          await navigator.clipboard.writeText(url);
          this.toast('Link copied');
        }
      } catch {
        /* user dismissed the share sheet, or clipboard was blocked */
      }
    });

    // Events panel — bottom right. A one-off list built once from the ±5-year
    // sweep, plus a live "next apoapsis" row that tracks the simulated clock.
    const events = document.createElement('div');
    events.className = 'panel hud-events';
    events.innerHTML = '<div class="hud-events-title">Events</div><div class="hud-events-list"></div>';
    hud.appendChild(events);
    this.eventsListEl = events.querySelector('.hud-events-list')!;

    // Help overlay ('?' toggles, Esc closes — bindings live in main.ts). Built
    // from the shared shortcut lists so it can never disagree with the keys.
    this.helpEl = document.createElement('div');
    this.helpEl.className = 'panel hud-help';
    const rows = (list: { keys: string; label: string }[]): string =>
      list.map((s) => `<span class="k">${s.keys}</span><span>${s.label}</span>`).join('');
    this.helpEl.innerHTML =
      `<h2>Controls</h2>
       <div class="hud-help-grid">${rows(POINTER_SHORTCUTS)}</div>
       <h3>Keyboard</h3>
       <div class="hud-help-grid">${rows(KEY_SHORTCUTS)}</div>`;
    hud.appendChild(this.helpEl);

    // First-visit hint: the camera model (no pan, H hides the HUD) isn't
    // obvious. Show once, dismiss on the first interaction, remember forever.
    let hinted = false;
    try { hinted = localStorage.getItem(HINT_KEY) === '1'; } catch { /* private mode */ }
    if (!hinted) {
      const hint = document.createElement('div');
      hint.className = 'hud-hint show';
      hint.textContent = 'Drag to orbit · Scroll to zoom · Click a moon';
      hud.appendChild(hint);
      const dismiss = (): void => {
        hint.classList.remove('show');
        setTimeout(() => hint.remove(), 500);
        try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
        window.removeEventListener('pointerdown', dismiss);
        window.removeEventListener('wheel', dismiss);
        window.removeEventListener('keydown', dismiss);
      };
      window.addEventListener('pointerdown', dismiss);
      window.addEventListener('wheel', dismiss, { passive: true });
      window.addEventListener('keydown', dismiss);
    }
  }

  /** Whether the help overlay is currently shown. */
  get helpOpen(): boolean {
    return this.helpEl.classList.contains('show');
  }

  /** Toggle the help overlay (bound to '?' in main.ts). */
  toggleHelp(): void {
    this.helpEl.classList.toggle('show');
  }

  /** Hide the help overlay (bound to Esc in main.ts). */
  closeHelp(): void {
    this.helpEl.classList.remove('show');
  }

  /** Reflect the camera FOV in the slider (URL restore / programmatic sync). */
  setFov(deg: number): void {
    this.fovInput.value = String(Math.round(deg));
  }

  /** Briefly show a status toast (~1.5 s), reusing the single toast element. */
  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1500);
  }

  setFocused(id: string): void {
    for (const [bid, btn] of this.bodyButtons) btn.classList.toggle('active', bid === id);
  }

  /** Reflect the paused state in the pause button (keyboard/programmatic sync). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseBtn.textContent = paused ? '▶' : '⏸';
  }

  /** Highlight the preset matching `value` (keyboard/programmatic sync). */
  setSpeed(value: number): void {
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', SPEEDS[i].value === value));
  }

  setInfo(def: BodyDefinition, live?: LiveInfo): void {
    this.infoName.textContent = def.name;
    this.infoBlurb.textContent = def.blurb ?? '';
    const rows: [string, string][] = [
      ['Radius', `${def.physical.radiusKm.toLocaleString('en-US')} km`],
    ];
    if (def.elements) {
      rows.push(
        ['Semi-major axis', `${Math.round(def.elements.aKm).toLocaleString('en-US')} km`],
        ['Orbital period', `${def.elements.periodDays.toFixed(2)} d`],
        ['Eccentricity', def.elements.e.toFixed(4)],
      );
    }
    // Live, camera-relative physics (updated a couple times a second).
    if (live?.distanceKm !== undefined) {
      rows.push(['Camera distance', `${Math.round(live.distanceKm).toLocaleString('en-US')} km`]);
    }
    if (live?.apparentDeg !== undefined) {
      rows.push(['Apparent size', fmtAngle(live.apparentDeg)]);
    }
    if (live?.phaseDeg !== undefined) {
      rows.push(['Phase angle', `${Math.round(live.phaseDeg)}°`]);
    }
    if (live?.sunlightPct !== undefined) {
      rows.push(['Sunlight', `${Math.round(live.sunlightPct)}%`]);
    }
    this.infoStats.innerHTML = rows
      .map(([k, v]) => `<span>${k}</span><b>${v}</b>`)
      .join('');
  }

  setDate(date: Date): void {
    this.lastDate = date;
    if (this.editing) return; // don't overwrite the picker while the user edits
    this.dateEl.textContent = fmtDate(date);
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }

  /** F10.3 — effective dynamic render-resolution (DPR) readout. */
  setDpr(dpr: number): void {
    this.dprEl.textContent = `${dpr.toFixed(2)}×`;
  }

  /** Build one clickable event row. `getEvent` is read at click time so the
   *  recurring apoapsis row always jumps to its latest recomputed time. */
  private eventRow(getEvent: () => SaturnEvent): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'hud-event';
    btn.innerHTML =
      '<span class="ev-icon"></span><span class="ev-name"></span><span class="ev-date"></span>';
    btn.addEventListener('click', () => this.onEventJump(getEvent()));
    return btn;
  }

  private fillEventRow(btn: HTMLButtonElement, e: SaturnEvent): void {
    btn.querySelector('.ev-icon')!.textContent = EVENT_ICON[e.category];
    btn.querySelector('.ev-name')!.textContent = e.rare ? `${e.name} (rare)` : e.name;
    btn.querySelector('.ev-date')!.textContent = fmtEventDate(e.jd);
    btn.title = `Jump to ${fmtEventDate(e.jd)} UTC`;
  }

  /**
   * F12.1 — populate the one-off event list (built once) and register the jump
   * handler. The recurring apoapsis row is created empty here and kept live via
   * setNextApoapsis so it never enumerates all ~2,700 occurrences.
   */
  setEvents(events: SaturnEvent[], onJump: (e: SaturnEvent) => void): void {
    this.onEventJump = onJump;
    this.eventsListEl.replaceChildren();

    // Live "next apoapsis" pinned at the top.
    this.apoapsisRow = this.eventRow(() => this.apoapsisEvent!);
    this.apoapsisRow.classList.add('recurring');
    this.eventsListEl.appendChild(this.apoapsisRow);

    for (const e of events) {
      const row = this.eventRow(() => e);
      this.fillEventRow(row, e);
      this.eventsListEl.appendChild(row);
    }
  }

  /** Refresh the recurring "next apoapsis" row from the live sim time. */
  setNextApoapsis(e: SaturnEvent): void {
    this.apoapsisEvent = e;
    if (this.apoapsisRow) this.fillEventRow(this.apoapsisRow, e);
  }
}
