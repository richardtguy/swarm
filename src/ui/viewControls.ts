/**
 * View controls: 2D/3D toggle, camera presets and overlay switches. These change only what is
 * drawn, never the simulation, so they emit view callbacks rather than simulation commands.
 * The viewer's choices are remembered in localStorage as a convenience; the page works the same
 * when storage is unavailable.
 */
import { CAMERA_PRESETS, type CameraPreset } from '../render/three/cameraRig';
import { DEFAULT_OVERLAYS, type OverlaySettings } from '../render/types';
import { el } from './dom';

export type ViewMode = '2d' | '3d';

export interface ViewPrefs {
  mode: ViewMode;
  preset: CameraPreset;
  overlays: OverlaySettings;
}

export interface ViewHandlers {
  onMode(mode: ViewMode): void;
  onPreset(preset: CameraPreset): void;
  onOverlays(overlays: Readonly<OverlaySettings>): void;
}

const STORAGE_KEY = 'swarm-fielding.view';

const PRESET_LABELS: Record<CameraPreset, string> = {
  'top-down': 'Top-down',
  stadium: 'Stadium',
  follow: 'Follow',
};

const OVERLAY_LABELS: { key: keyof OverlaySettings; label: string; only3d: boolean }[] = [
  { key: 'arcs', label: 'Arcs', only3d: true },
  { key: 'landingRings', label: 'Landing rings', only3d: false },
  { key: 'targetLines', label: 'Target lines', only3d: false },
  { key: 'targetColours', label: 'Target colours', only3d: false },
  { key: 'commsLinks', label: 'Comms links', only3d: true },
  { key: 'nearMisses', label: 'Near-misses', only3d: false },
];

/** Stored view preferences merged over the defaults. Never throws. */
export function loadViewPrefs(): ViewPrefs {
  const prefs: ViewPrefs = { mode: '3d', preset: 'stadium', overlays: { ...DEFAULT_OVERLAYS } };
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return prefs;
    const s = stored as Partial<Record<keyof ViewPrefs, unknown>>;
    if (s.mode === '2d' || s.mode === '3d') prefs.mode = s.mode;
    if (CAMERA_PRESETS.includes(s.preset as CameraPreset)) prefs.preset = s.preset as CameraPreset;
    if (typeof s.overlays === 'object' && s.overlays !== null) {
      for (const { key } of OVERLAY_LABELS) {
        const v = (s.overlays as Record<string, unknown>)[key];
        if (typeof v === 'boolean') prefs.overlays[key] = v;
      }
    }
  } catch {
    // Storage blocked or corrupt: use the defaults.
  }
  return prefs;
}

function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: preferences simply are not remembered.
  }
}

export class ViewControls {
  readonly element: HTMLElement;
  private readonly prefs: ViewPrefs;
  private readonly modeButtons = new Map<ViewMode, HTMLButtonElement>();
  private readonly presetButtons = new Map<CameraPreset, HTMLButtonElement>();
  private readonly overlayInputs = new Map<keyof OverlaySettings, HTMLInputElement>();
  private readonly cameraGroup: HTMLElement;
  private readonly followHint: HTMLElement;

  constructor(prefs: ViewPrefs, handlers: ViewHandlers) {
    this.prefs = { ...prefs, overlays: { ...prefs.overlays } };

    const modeGroup = el('div', { class: 'segmented', role: 'group', 'aria-label': 'View' });
    for (const mode of ['2d', '3d'] as const) {
      const button = el('button', { type: 'button', text: mode.toUpperCase() });
      button.addEventListener('click', () => {
        this.prefs.mode = mode;
        this.refresh();
        handlers.onMode(mode);
      });
      this.modeButtons.set(mode, button);
      modeGroup.append(button);
    }

    this.cameraGroup = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Camera' });
    for (const preset of CAMERA_PRESETS) {
      const button = el('button', { type: 'button', text: PRESET_LABELS[preset] });
      button.addEventListener('click', () => {
        this.prefs.preset = preset;
        this.refresh();
        handlers.onPreset(preset);
      });
      this.presetButtons.set(preset, button);
      this.cameraGroup.append(button);
    }
    this.followHint = el('span', { class: 'hint', text: 'Click a fielder to follow it.' });

    const overlayGroup = el('div', { class: 'controls overlays' });
    for (const { key, label } of OVERLAY_LABELS) {
      const input = el('input', { type: 'checkbox' });
      input.checked = this.prefs.overlays[key];
      input.addEventListener('change', () => {
        this.prefs.overlays[key] = input.checked;
        saveViewPrefs(this.prefs);
        handlers.onOverlays({ ...this.prefs.overlays });
      });
      this.overlayInputs.set(key, input);
      overlayGroup.append(el('label', { class: 'control checkbox' }, [input, label]));
    }

    // Each label stays on the same line as its buttons when the row wraps on narrow screens.
    this.element = el('div', { class: 'controls view-controls' }, [
      el('span', { class: 'control' }, [el('span', { text: 'View' }), modeGroup]),
      el('span', { class: 'control' }, [el('span', { text: 'Camera' }), this.cameraGroup]),
      this.followHint,
      overlayGroup,
    ]);
    this.refresh();
  }

  /** Show the follow hint while following with nothing selected. */
  setFollowHint(show: boolean): void {
    this.followHint.hidden = !(show && this.prefs.mode === '3d' && this.prefs.preset === 'follow');
  }

  /** Reflect a mode forced by the page, e.g. a fallback to 2D when WebGL is unavailable. */
  setMode(mode: ViewMode): void {
    this.prefs.mode = mode;
    this.refresh();
  }

  private refresh(): void {
    const is3d = this.prefs.mode === '3d';
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute('aria-pressed', String(mode === this.prefs.mode));
    }
    for (const [preset, button] of this.presetButtons) {
      button.setAttribute('aria-pressed', String(preset === this.prefs.preset));
      button.disabled = !is3d;
    }
    for (const { key, only3d } of OVERLAY_LABELS) {
      const input = this.overlayInputs.get(key);
      if (input === undefined) continue;
      input.disabled = only3d && !is3d;
      input.parentElement?.setAttribute('title', input.disabled ? '3D view only' : '');
    }
    this.cameraGroup.classList.toggle('disabled', !is3d);
    this.setFollowHint(!this.followHint.hidden);
    saveViewPrefs(this.prefs);
  }
}
