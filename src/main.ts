/**
 * Browser entry point. Phase 0 runs the simulation on the main thread and shows the tick,
 * time and state hash. The Web Worker host and renderers arrive in Phase 1.
 */
import { Simulation } from './core/sim';
import { FixedStepAccumulator } from './core/loop';
import { DEFAULT_CONFIG, cloneConfig } from './core/config';

const HASH_TICKS = 500;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T;
}

const tickEl = byId<HTMLElement>('tick');
const timeEl = byId<HTMLElement>('time');
const aliveEl = byId<HTMLElement>('alive');
const hashEl = byId<HTMLElement>('hash');
const pauseBtn = byId<HTMLButtonElement>('pause');
const stepBtn = byId<HTMLButtonElement>('step');
const resetBtn = byId<HTMLButtonElement>('reset');
const seedInput = byId<HTMLInputElement>('seed');
const hashRunBtn = byId<HTMLButtonElement>('hash-run');

const sim = new Simulation(DEFAULT_CONFIG);
const clock = new FixedStepAccumulator(sim.config.dt);
let lastFrame: number | null = null;

function render(): void {
  const m = sim.metrics();
  tickEl.textContent = String(m.tick);
  timeEl.textContent = m.time.toFixed(2);
  aliveEl.textContent = `${m.fieldersAlive} / ${m.fieldersTotal}`;
  hashEl.innerHTML = `<code>${sim.hash()}</code>`;
  pauseBtn.textContent = sim.paused ? 'Resume' : 'Pause';
}

function frame(now: number): void {
  if (lastFrame !== null && !sim.paused) {
    const steps = clock.advance((now - lastFrame) / 1000);
    for (let i = 0; i < steps; i++) sim.advance();
  }
  lastFrame = now;
  render();
  requestAnimationFrame(frame);
}

function configFromInputs() {
  const config = cloneConfig(DEFAULT_CONFIG);
  const seed = Number.parseInt(seedInput.value, 10);
  if (Number.isFinite(seed)) config.seed = seed;
  return config;
}

pauseBtn.addEventListener('click', () => {
  sim.apply({ type: sim.paused ? 'resume' : 'pause' });
  clock.clear();
  render();
});

stepBtn.addEventListener('click', () => {
  sim.apply({ type: 'step' });
  render();
});

resetBtn.addEventListener('click', () => {
  sim.apply({ type: 'init', config: configFromInputs() });
  clock.clear();
  render();
});

hashRunBtn.addEventListener('click', () => {
  sim.apply({ type: 'init', config: configFromInputs() });
  sim.apply({ type: 'pause' });
  sim.apply({ type: 'step', ticks: HASH_TICKS });
  clock.clear();
  render();
});

render();
requestAnimationFrame(frame);
