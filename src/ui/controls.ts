/**
 * The control panel: scenario, strategy, seed, speed, and run controls. It never touches the
 * simulation directly; every action is emitted as a command for the host to forward.
 */
import type { SimCommand } from '../core/commands';
import { DEFAULT_CONFIG, cloneConfig, type SimConfig } from '../core/config';
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

export class Controls {
  readonly element: HTMLElement;
  private readonly scenarioSelect: HTMLSelectElement;
  private readonly strategySelect: HTMLSelectElement;
  private readonly seedInput: HTMLInputElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly pauseButton: HTMLButtonElement;
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

    this.element = el('div', { class: 'controls' }, [
      labelled('Scenario', this.scenarioSelect),
      labelled('Strategy', this.strategySelect),
      labelled('Seed', this.seedInput),
      labelled('Speed', this.speedSelect),
      this.pauseButton,
      stepButton,
      resetButton,
    ]);

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
    return config;
  }

  /** Reflect the worker's paused state. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }
}
