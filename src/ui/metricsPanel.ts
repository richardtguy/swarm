/**
 * Live metrics readout, fed by frames from the worker, including the gap to the oracle run
 * on the same seed.
 */
import { RECENT_WINDOW, type MetricsSummary } from '../core/metrics/metrics';
import { el } from './dom';

export interface MetricsHandlers {
  /** Ask the worker for the current state hash. */
  onRequestHash(): void;
}

export class MetricsPanel {
  readonly element: HTMLElement;
  private readonly cells = new Map<string, HTMLElement>();
  private readonly strategyLine: HTMLElement;
  private readonly hashLine: HTMLElement;
  private readonly statusLine: HTMLElement;

  constructor(handlers: MetricsHandlers) {
    const rows: [string, string][] = [
      ['tick', 'Tick'],
      ['time', 'Sim time (s)'],
      ['fielders', 'Fielders alive'],
      ['launched', 'Balls launched'],
      ['inFlight', 'In flight'],
      ['caught', 'Caught'],
      ['dropped', 'Dropped'],
      ['catchRate', 'Catch rate'],
      ['oracleRate', 'Oracle, same seed'],
      ['relative', 'Relative to oracle'],
      ['recent', `Last ${RECENT_WINDOW} balls`],
      ['recentOracle', `Oracle, last ${RECENT_WINDOW}`],
      ['contested', 'Balls chased by 2+'],
      ['nearMisses', 'Near-misses'],
      ['sent', 'Messages sent'],
      ['delivered', 'Delivered'],
      ['msgDropped', 'Messages dropped'],
      ['messageRate', 'Msgs / fielder / s'],
      ['distance', 'Distance (m)'],
    ];
    const dl = el('dl', { class: 'readout' });
    for (const [key, label] of rows) {
      if (this.cells.has(key)) throw new Error(`Duplicate metrics row key "${key}"`);
      const dd = el('dd', { text: '—' });
      this.cells.set(key, dd);
      dl.append(el('dt', { text: label }), dd);
    }
    this.strategyLine = el('p', { class: 'strategy', text: '' });
    this.statusLine = el('p', { class: 'status', text: '' });
    const hashButton = el('button', { type: 'button', text: 'Hash state' });
    hashButton.addEventListener('click', () => handlers.onRequestHash());
    this.hashLine = el('code', { text: '' });
    this.element = el('div', { class: 'metrics' }, [
      this.strategyLine,
      dl,
      this.statusLine,
      el('div', { class: 'hash' }, [hashButton, this.hashLine]),
    ]);
  }

  update(
    m: MetricsSummary,
    strategy: { name: string; isOracle: boolean },
    finished: boolean,
    reference: MetricsSummary | null,
  ): void {
    this.set('tick', String(m.tick));
    this.set('time', m.time.toFixed(2));
    this.set('fielders', `${m.fieldersAlive} / ${m.fieldersTotal}`);
    this.set('launched', String(m.ballsLaunched));
    this.set('inFlight', String(m.ballsInFlight));
    this.set('caught', String(m.ballsCaught));
    this.set('dropped', String(m.ballsDropped));
    this.set('catchRate', percent(m.catchRate));
    if (reference === null) {
      this.set('oracleRate', strategy.isOracle ? '(this run)' : '—');
      this.set('relative', '—');
    } else {
      this.set('oracleRate', `${percent(reference.catchRate)} (${reference.ballsCaught} caught)`);
      this.set(
        'relative',
        reference.catchRate > 0 ? percent(m.catchRate / reference.catchRate) : '—',
      );
    }
    this.set('recent', m.recentSettled > 0 ? percent(m.recentCatchRate) : '—');
    this.set(
      'recentOracle',
      reference !== null && reference.recentSettled > 0 ? percent(reference.recentCatchRate) : '—',
    );
    this.set('contested', String(m.contestedBalls));
    this.set('nearMisses', String(m.nearMisses));
    this.set('sent', String(m.messagesSent));
    this.set('delivered', String(m.messagesDelivered));
    this.set(
      'msgDropped',
      `${m.droppedBandwidth} bandwidth · ${m.droppedLoss} loss · ${m.droppedRecipientDead} dead`,
    );
    this.set('messageRate', m.messageRate.toFixed(2));
    this.set('distance', m.distanceTravelled.toFixed(0));
    this.strategyLine.textContent = strategy.isOracle
      ? `Strategy: ${strategy.name} — ORACLE benchmark (global knowledge)`
      : `Strategy: ${strategy.name}`;
    this.strategyLine.classList.toggle('oracle', strategy.isOracle);
    this.statusLine.textContent = finished ? 'Run finished.' : '';
  }

  showHash(tick: number, hash: string): void {
    this.hashLine.textContent = `tick ${tick}: ${hash}`;
  }

  showError(message: string): void {
    this.statusLine.textContent = `Error: ${message}`;
  }

  private set(key: string, value: string): void {
    const cell = this.cells.get(key);
    if (cell !== undefined) cell.textContent = value;
  }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
