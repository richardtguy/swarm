/**
 * The fielder inspector: what the selected fielder knew when it last decided. It shows the
 * fielder's state, the balls it sees with slack, its claims table and its recent inbox. The data
 * comes from the Worker as an `Inspection`; this panel only displays it.
 */
import type { Inspection } from '../core/inspection';
import { el } from './dom';

export interface InspectorHandlers {
  /** Kill the inspected fielder. */
  onKill(id: number): void;
  /** Stop inspecting. */
  onClose(): void;
}

export class Inspector {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly killButton: HTMLButtonElement;
  private current: number | null = null;

  constructor(handlers: InspectorHandlers) {
    this.title = el('h2', { text: 'Inspector' });
    this.killButton = el('button', { type: 'button', text: 'Kill' });
    const close = el('button', { type: 'button', text: 'Close' });
    this.killButton.addEventListener('click', () => {
      if (this.current !== null) handlers.onKill(this.current);
    });
    close.addEventListener('click', () => handlers.onClose());
    this.body = el('div', { class: 'inspector-body' });
    this.element = el('section', { class: 'inspector' }, [
      el('div', { class: 'inspector-head' }, [this.title, this.killButton, close]),
      this.body,
    ]);
    this.element.hidden = true;
  }

  /** Show `inspection`, or hide the panel when it is null. */
  update(inspection: Inspection | null): void {
    this.element.hidden = inspection === null;
    this.current = inspection === null ? null : inspection.id;
    if (inspection === null) return;
    const i = inspection;
    this.title.textContent = `Fielder ${i.id}${i.alive ? '' : ' (dead)'}`;
    this.killButton.disabled = !i.alive;

    const [x, y] = i.position;
    const summary = el('dl', { class: 'readout' }, [
      ...pair('Position', `${x.toFixed(1)}, ${y.toFixed(1)} m`),
      ...pair('Speed', `${i.speed.toFixed(1)} m/s`),
      ...pair('Target', i.targetBallId === null ? 'none (going home)' : `ball ${i.targetBallId}`),
      ...pair('Sent', i.sent.length > 0 ? i.sent.join(', ') : 'nothing'),
      ...pair('Neighbours', String(i.neighbours)),
    ]);

    const parts: HTMLElement[] = [summary];
    if (!i.hasView) {
      const why = !i.alive
        ? 'Dead fielders no longer sense or decide.'
        : i.strategy === 'centralised'
          ? 'Oracle fielders follow the central plan and have no local view.'
          : 'Step or resume the run to capture this fielder’s view.';
      parts.push(el('p', { class: 'status', text: why }));
    }
    parts.push(
      section(
        `Sees ${i.balls.length} ball${i.balls.length === 1 ? '' : 's'}`,
        table(
          ['Ball', 'ETA', 'Slack', 'Holder'],
          i.balls.map((b) => [
            b.id === i.targetBallId ? `${b.id} ◀` : String(b.id),
            `${b.eta.toFixed(2)} s`,
            b.feasible ? `${b.slack.toFixed(2)} s` : `${b.slack.toFixed(2)} s ✕`,
            b.holder < 0 ? '—' : b.holder === i.id ? 'me' : String(b.holder),
          ]),
        ),
      ),
    );
    if (i.claims !== null) {
      parts.push(
        section(
          'Claims table',
          table(
            ['Ball', 'Claimant', 'Arrives', 'Age'],
            i.claims.map((c) => [
              String(c.ballId),
              `${c.claimant === i.id ? 'me' : c.claimant}${c.winning ? ' ★' : ''}`,
              `${c.eta.toFixed(2)} s`,
              `${c.ageTicks} ticks`,
            ]),
          ),
        ),
      );
    }
    parts.push(
      section(
        'Recent inbox',
        table(
          ['Tick', 'From', 'Message'],
          i.inbox.map((m) => [
            String(m.receivedTick),
            String(m.from),
            [
              m.type,
              m.ballId === null ? '' : `ball ${m.ballId}`,
              m.eta === null ? '' : `@ ${m.eta.toFixed(2)} s`,
            ]
              .filter((s) => s !== '')
              .join(' '),
          ]),
        ),
      ),
    );
    this.body.replaceChildren(...parts);
  }
}

function pair(label: string, value: string): HTMLElement[] {
  return [el('dt', { text: label }), el('dd', { text: value })];
}

function section(heading: string, content: HTMLElement): HTMLElement {
  return el('div', { class: 'inspector-section' }, [el('h3', { text: heading }), content]);
}

function table(headers: string[], rows: string[][]): HTMLElement {
  if (rows.length === 0) return el('p', { class: 'status', text: 'None.' });
  const head = el(
    'tr',
    {},
    headers.map((h) => el('th', { text: h })),
  );
  const body = rows.map((r) =>
    el(
      'tr',
      {},
      r.map((c) => el('td', { text: c })),
    ),
  );
  return el('table', { class: 'inspector-table' }, [
    el('thead', {}, [head]),
    el('tbody', {}, body),
  ]);
}
