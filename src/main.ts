/**
 * Browser entry point: runs the simulation in a Web Worker, draws the latest frame with the 2D
 * renderer, and wires the control and metrics panels.
 */
import { TopDown2D } from './render/topdown2d/topDown2D';
import type { RenderFrame } from './render/types';
import { Controls } from './ui/controls';
import { MetricsPanel } from './ui/metricsPanel';
import type { FrameMessage, WorkerCommand, WorkerMessage } from './worker/protocol';

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing element #${id}`);
  return node;
}

const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
const send = (message: WorkerCommand): void => worker.postMessage(message);

const controls = new Controls({
  onCommand: (command) => send({ type: 'command', command }),
  onTimeScale: (timeScale) => send({ type: 'setTimeScale', timeScale }),
});
const metrics = new MetricsPanel({
  onRequestHash: () => send({ type: 'requestHash' }),
});
const renderer = new TopDown2D();

byId('controls').append(controls.element);
byId('metrics').append(metrics.element);
byId('view').append(renderer.element);

let latest: FrameMessage | null = null;
let selectedFielder: number | null = null;
let needsDraw = false;

renderer.element.addEventListener('click', (event) => {
  selectedFielder = renderer.pick(event.clientX, event.clientY);
  needsDraw = true;
});

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'ready':
      send({ type: 'command', command: { type: 'init', config: controls.buildConfig() } });
      break;
    case 'frame':
      latest = message;
      needsDraw = true;
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

function draw(): void {
  if (needsDraw && latest !== null) {
    const frame: RenderFrame = { snapshot: latest.snapshot, selectedFielder };
    renderer.render(frame);
    needsDraw = false;
  }
  requestAnimationFrame(draw);
}

renderer.resize();
requestAnimationFrame(draw);
