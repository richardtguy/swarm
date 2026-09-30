/**
 * The control panel: scenario, strategy, seed, speed, run controls and live parameter sliders.
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
      labelled('Speed', this.speedSelect),
      this.pauseButton,
      stepButton,
      resetButton,
    ]);
    const sliderRow = el('div', { class: 'controls sliders' });
    for (const spec of SLIDERS) sliderRow.append(this.buildSlider(spec, handlers));
    this.element = el('div', { class: 'control-panel' }, [runRow, sliderRow]);

    const restart = (): void => handlers.onCommand({ type: 'init', config: this.buildConfig() });
    this.scenarioSelect.addEventListener('change', restart);
    this.strategySelect.addEventListener('change', restart);
    this.seedInput.addEventListener('change', restart);
    resetButton.addEventListener('click', restart);
    this.speedSelect.addEventListener('change', () =>
      handlers.onTimeScale(Number(this.speedSelect.value)),
    );
    this.pauseButton.addEventListener('click', () => {
      handlers.onCommand({ type: this.paused ? 'resume' : 'pause' });
    });
    stepButton.addEventListener('click', () => handlers.onCommand({ type: 'step' }));
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

  /** The config described by the current control values. */
  buildConfig(): SimConfig {
    const base = SCENARIOS[this.scenarioSelect.value] ?? {};
    const config =
      this.scenarioSelect.value === 'default'
        ? cloneConfig(DEFAULT_CONFIG)
        : validateScenario(base);
    const seed = Number.parseInt(this.seedInput.value, 10);
    if (Number.isFinite(seed) && seed >= 0) config.seed = seed;
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

function readPath(config: Readonly<SimConfig>, path: string): number {
  let node: unknown = config;
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  return node as number;
}
