/** DOM HUD: time controls, body selector, info panel. No framework needed. */

import './hud.css';
import type { BodyDefinition } from '../orbital/types.ts';
import { PRESETS, quality, setQuality, type QualityName } from '../core/quality.ts';

export interface HudCallbacks {
  onFocus(id: string): void;
  onSpeed(speed: number): void;
  onPause(paused: boolean): void;
  onNow(): void;
  onToggleOrbits(v: boolean): void;
  onToggleLabels(v: boolean): void;
  onToggleDrift(v: boolean): void;
  onExposure(v: number): void;
  onCinema(): void;
}

const SPEEDS: { label: string; value: number }[] = [
  { label: '1×', value: 1 },
  { label: '1 min/s', value: 60 },
  { label: '1 h/s', value: 3600 },
  { label: '6 h/s', value: 21600 },
  { label: '1 d/s', value: 86400 },
  { label: '5 d/s', value: 432000 },
];

export class Hud {
  private readonly dateEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly infoName: HTMLElement;
  private readonly infoBlurb: HTMLElement;
  private readonly infoStats: HTMLElement;
  private readonly bodyButtons = new Map<string, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private pauseBtn!: HTMLButtonElement;
  private paused = false;

  constructor(bodies: BodyDefinition[], backend: string, cb: HudCallbacks) {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.appendChild(hud);

    // Brand.
    const brand = document.createElement('div');
    brand.className = 'panel hud-brand';
    brand.innerHTML = `<h1>SATURN</h1><div class="sub"><span class="hud-badge">${backend}</span><span class="fps"></span></div>`;
    hud.appendChild(brand);
    this.fpsEl = brand.querySelector('.fps')!;

    // Body list.
    const list = document.createElement('div');
    list.className = 'panel hud-bodies';
    for (const def of bodies) {
      const btn = document.createElement('button');
      btn.textContent = def.name;
      btn.addEventListener('click', () => cb.onFocus(def.id));
      list.appendChild(btn);
      this.bodyButtons.set(def.id, btn);
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

    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
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
    this.speedButtons[2].classList.add('active');

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
      <div class="hud-quality">
        <span>Quality</span>
        <div class="hud-quality-btns"></div>
        <button type="button" class="hud-cinema" title="Cinematic tour (Esc exits)">✦ Cinema</button>
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
  }

  setFocused(id: string): void {
    for (const [bid, btn] of this.bodyButtons) btn.classList.toggle('active', bid === id);
  }

  setInfo(def: BodyDefinition, distanceKm?: number): void {
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
    if (distanceKm !== undefined) {
      rows.push(['Camera distance', `${Math.round(distanceKm).toLocaleString('en-US')} km`]);
    }
    this.infoStats.innerHTML = rows
      .map(([k, v]) => `<span>${k}</span><b>${v}</b>`)
      .join('');
  }

  setDate(date: Date): void {
    this.dateEl.textContent = date.toISOString().slice(0, 19).replace('T', '  ') + ' UTC';
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }
}
