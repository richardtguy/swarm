/**
 * The control panel: scenario, strategy, seed, fielder and ball counts, speed, run controls and live parameter sliders.
 * It never touches the simulation directly; every action is emitted as a command for the host
 * to forward.
 */
import type { SimCommand } from '../core/commands';
import { DEFAULT_CONFIG, cloneConfig, setParam, type SimConfig } from '../core/config';
import { validateScenario } from '../core/scenario/schema';
import { getStrategy, strategyNames } from '../core/strategies/index';
import baselineScenario from '../../scenarios/baseline.json';
import denseSalvoScenario from '../../scenarios/dense-salvo.json';
import { el, labelled, select } from './dom';

export interface ControlsHandlers {
  /** Forward a simulation command to the worker. */
  onCommand(command: SimCommand): void;
  /** Change playback speed (sim seconds per wall-clock second). */
  onTimeScale(scale: number): void;
}

const SCENARIOS: Record<string, unknown> = {
  baseline: baselineScenario,
  'dense-salvo': denseSalvoScenario,
  default: {},
};

const TIME_SCALES = [0.25, 0.5, 1, 2, 4];

/** Upper bound for the count inputs: the real-time performance target (CLAUDE.md section 11). */
const MAX_COUNT = 500;

/** A live numeric parameter exposed as a slider. Changes apply immediately via `setParam`. */
interface SliderSpec {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const SLIDERS: SliderSpec[] = [
  { path: 'fielders.maxSpeed', label: 'Max speed', min: 1, max: 15, step: 0.5, unit: 'm/s' },
  { path: 'sensing.range', label: 'Sensing range', min: 5, max: 150, step: 5, unit: 'm' },
  { path: 'sensing.noise', label: 'Sensing noise', min: 0, max: 3, step: 0.1, unit: 'm' },
  { path: 'strategy.separationRadius', label: 'Separation', min: 0, max: 6, step: 0.5, unit: 'm' },
];

export class Controls {
  readonly element: HTMLElement;
  private readonly scenarioSelect: HTMLSelectElement;
  private readonly strategySelect: HTMLSelectElement;
  private readonly seedInput: HTMLInputElement;
  private readonly fielderCountInput: HTMLInputElement;
  private readonly ballCountInput: HTMLInputElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly sliders = new Map<string, HTMLInputElement>();
  private paused = false;

  constructor(handlers: ControlsHandlers) {
    this.scenarioSelect = select(Object.keys(SCENARIOS).map((k) => ({ value: k, label: k })));
    this.strategySelect = select(
      strategyNames().map((name) => ({
        value: name,
        label: getStrategy(name).isOracle ? `${name} (oracle)` : name,
      })),
      DEFAULT_CONFIG.strategy.name,
    );
    this.seedInput = el('input', {
      type: 'number',
      min: '0',
      step: '1',
      value: String(DEFAULT_CONFIG.seed),
    });
    this.fielderCountInput = countInput(DEFAULT_CONFIG.fielders.count);
    this.ballCountInput = countInput(DEFAULT_CONFIG.launch.count);
    this.speedSelect = select(
      TIME_SCALES.map((s) => ({ value: String(s), label: `${s}×` })),
      '1',
    );
    this.pauseButton = el('button', { type: 'button', text: 'Pause' });
    const stepButton = el('button', { type: 'button', text: 'Step' });
    const resetButton = el('button', { type: 'button', text: 'Reset' });

    const runRow = el('div', { class: 'controls' }, [
      labelled('Scenario', this.scenarioSelect),
      labelled('Strategy', this.strategySelect),
      labelled('Seed', this.seedInput),
      labelled('Fielders', this.fielderCountInput),
      labelled('Balls', this.ballCountInput),
      labelled('Speed', this.speedSelect),
      this.pauseButton,
      stepButton,
      resetButton,
    ]);
    const sliderRow = el('div', { class: 'controls sliders' });
    for (const spec of SLIDERS) sliderRow.append(this.buildSlider(spec, handlers));
    this.element = el('div', { class: 'control-panel' }, [runRow, sliderRow]);

    const restart = (): void => handlers.onCommand({ type: 'init', config: this.buildConfig() });
    this.scenarioSelect.addEventListener('change', () => {
      this.showScenarioCounts();
      restart();
    });
    this.strategySelect.addEventListener('change', restart);
    this.seedInput.addEventListener('change', restart);
    this.fielderCountInput.addEventListener('change', restart);
    this.ballCountInput.addEventListener('change', restart);
    resetButton.addEventListener('click', restart);
    this.speedSelect.addEventListener('change', () =>
      handlers.onTimeScale(Number(this.speedSelect.value)),
    );
    this.pauseButton.addEventListener('click', () => {
      handlers.onCommand({ type: this.paused ? 'resume' : 'pause' });
    });
    stepButton.addEventListener('click', () => handlers.onCommand({ type: 'step' }));
    this.showScenarioCounts();
  }

  private buildSlider(spec: SliderSpec, handlers: ControlsHandlers): HTMLElement {
    const initial = readPath(DEFAULT_CONFIG, spec.path);
    const input = el('input', {
      type: 'range',
      min: String(spec.min),
      max: String(spec.max),
      step: String(spec.step),
      value: String(initial),
    });
    const value = el('span', { class: 'value', text: `${initial} ${spec.unit}` });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      value.textContent = `${v} ${spec.unit}`;
      handlers.onCommand({ type: 'setParam', path: spec.path, value: v });
    });
    this.sliders.set(spec.path, input);
    return el('label', { class: 'control slider' }, [
      el('span', { text: spec.label }),
      input,
      value,
    ]);
  }

  /** The selected scenario's config, before any control overrides. */
  private scenarioConfig(): SimConfig {
    return this.scenarioSelect.value === 'default'
      ? cloneConfig(DEFAULT_CONFIG)
      : validateScenario(SCENARIOS[this.scenarioSelect.value] ?? {});
  }

  /** Load the selected scenario's fielder and ball counts into the count inputs. */
  private showScenarioCounts(): void {
    const config = this.scenarioConfig();
    this.fielderCountInput.value = String(config.fielders.count);
    this.ballCountInput.value = String(config.launch.count);
  }

  /** The config described by the current control values. */
  buildConfig(): SimConfig {
    const config = this.scenarioConfig();
    const seed = Number.parseInt(this.seedInput.value, 10);
    if (Number.isFinite(seed) && seed >= 0) config.seed = seed;
    config.fielders.count = readCount(this.fielderCountInput, config.fielders.count);
    config.launch.count = readCount(this.ballCountInput, config.launch.count);
    config.strategy.name = this.strategySelect.value;
    for (const [path, input] of this.sliders) setParam(config, path, Number(input.value));
    return config;
  }

  /** Reflect the worker's paused state. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }
}

function countInput(initial: number): HTMLInputElement {
  return el('input', {
    type: 'number',
    min: '0',
    max: String(MAX_COUNT),
    step: '1',
    value: String(initial),
  });
}

/**
 * Parse a count input, clamped to [0, MAX_COUNT]. Falls back to `fallback` when the field is
 * not a number. The input is rewritten with the value actually used.
 */
function readCount(input: HTMLInputElement, fallback: number): number {
  const parsed = Number.parseInt(input.value, 10);
  const count = Number.isFinite(parsed) ? Math.min(MAX_COUNT, Math.max(0, parsed)) : fallback;
  input.value = String(count);
  return count;
}

function readPath(config: Readonly<SimConfig>, path: string): number {
  let node: unknown = config;
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  return node as number;
}
