/**
 * Browser entry point: runs the simulation in a Web Worker, draws blended snapshots with the 3D
 * or 2D renderer, and wires the control, view and metrics panels.
 */
import { SnapshotInterpolator } from './render/interpolate';
import type { CameraPreset } from './render/three/cameraRig';
import { Scene3D } from './render/three/scene3d';
import { TopDown2D } from './render/topdown2d/topDown2D';
import type { OverlaySettings, Renderer } from './render/types';
import { Controls } from './ui/controls';
import { MetricsPanel } from './ui/metricsPanel';
import { ViewControls, loadViewPrefs, type ViewMode } from './ui/viewControls';
import type { WorkerCommand, WorkerMessage } from './worker/protocol';

/** A pointer that moves further than this (px) between down and up is a drag, not a click. */
const CLICK_SLOP_PX = 6;

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing element #${id}`);
  return node;
}

const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
const send = (message: WorkerCommand): void => worker.postMessage(message);

const prefs = loadViewPrefs();
let overlays: Readonly<OverlaySettings> = prefs.overlays;
let preset: CameraPreset = prefs.preset;
let selectedFielder: number | null = null;
let fielderCount = 0;
const interpolator = new SnapshotInterpolator();

const controls = new Controls({
  onCommand: (command) => {
    if (command.type === 'init') interpolator.clear();
    send({ type: 'command', command });
  },
  onTimeScale: (timeScale) => send({ type: 'setTimeScale', timeScale }),
});
const metrics = new MetricsPanel({
  onRequestHash: () => send({ type: 'requestHash' }),
});
const viewControls = new ViewControls(prefs, {
  onMode: (mode) => mount(mode),
  onPreset: (p) => {
    preset = p;
    if (renderer instanceof Scene3D) renderer.setCameraPreset(p);
  },
  onOverlays: (o) => {
    overlays = o;
  },
});

const controlsHost = byId('controls');
controlsHost.append(controls.element, viewControls.element);
byId('metrics').append(metrics.element);
const view = byId('view');

// Collapsible control panel: collapsed on narrow screens, following the breakpoint as the window
// changes size until the viewer toggles it by hand.
const toggle = byId('toggle-controls');
const narrow = window.matchMedia('(max-width: 720px)');
let toggledByHand = false;
const setCollapsed = (collapsed: boolean): void => {
  controlsHost.hidden = collapsed;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? 'Show controls' : 'Hide controls';
};
setCollapsed(narrow.matches);
narrow.addEventListener('change', (e) => {
  if (!toggledByHand) setCollapsed(e.matches);
});
toggle.addEventListener('click', () => {
  toggledByHand = true;
  setCollapsed(!controlsHost.hidden);
});

let renderer: Renderer = new TopDown2D();

/** Replace the renderer. Falls back to 2D if WebGL is unavailable. */
function mount(mode: ViewMode): void {
  renderer.dispose();
  view.replaceChildren();
  let next: Renderer;
  if (mode === '3d') {
    try {
      const scene = new Scene3D();
      scene.setCameraPreset(preset);
      next = scene;
    } catch (error) {
      metrics.showError(`3D view unavailable (${String(error)}); showing 2D.`);
      viewControls.setMode('2d');
      next = new TopDown2D();
    }
  } else {
    next = new TopDown2D();
  }
  renderer = next;
  view.append(renderer.element);
  listenForPicks(renderer);
  renderer.resize();
}

/** Select a fielder on click or tap, but not at the end of a camera drag. */
function listenForPicks(target: Renderer): void {
  let down: { x: number; y: number } | null = null;
  target.element.addEventListener('pointerdown', (e) => {
    down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  });
  target.element.addEventListener('pointerup', (e) => {
    if (down === null || !e.isPrimary) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_SLOP_PX) return;
    selectedFielder = target.pick(e.clientX, e.clientY);
  });
}

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'ready':
      send({ type: 'command', command: { type: 'init', config: controls.buildConfig() } });
      break;
    case 'frame':
      interpolator.push(message.snapshot, performance.now());
      fielderCount = message.snapshot.fielderCount;
      if (selectedFielder !== null && selectedFielder >= fielderCount) selectedFielder = null;
      controls.setPaused(message.paused);
      metrics.update(message.metrics, message.strategy, message.finished, message.reference);
      break;
    case 'hash':
      metrics.showHash(message.tick, message.hash);
      break;
    case 'error':
      metrics.showError(message.message);
      break;
  }
};

function draw(now: number): void {
  const snapshot = interpolator.sample(now);
  if (snapshot !== null) renderer.render({ snapshot, selectedFielder, overlays });
  viewControls.setFollowHint(selectedFielder === null);
  requestAnimationFrame(draw);
}

mount(prefs.mode);
requestAnimationFrame(draw);
