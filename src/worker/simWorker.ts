/**
 * Web Worker entry: binds a `SimHost` to the worker's message port and drives it from a timer.
 */
import type { WorkerCommand, WorkerMessage } from './protocol';
import { SimHost } from './simHost';

/** Wall-clock interval between pumps (ms). Frames are posted at most this often. */
const PUMP_INTERVAL_MS = 16;

const host = new SimHost((message: WorkerMessage, transfer?: ArrayBuffer[]) => {
  self.postMessage(message, transfer ?? []);
});

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  host.handle(event.data);
};

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  host.pump((now - last) / 1000);
  last = now;
}, PUMP_INTERVAL_MS);

self.postMessage({ type: 'ready' } satisfies WorkerMessage);
