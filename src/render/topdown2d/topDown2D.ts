/**
 * Canvas 2D top-down renderer: the clearest view for explaining allocation.
 *
 * Core x (east) maps to canvas right and core y (north) to canvas up. Height is shown by ball
 * size and a ground shadow. Colours come from CSS custom properties so themes apply.
 */
import { predictLandingAt } from '../../core/physics/ballistics';
import type { WorldSnapshot } from '../../core/snapshot';
import { BallState } from '../../core/state';
import { vec3 } from '../../core/vec3';
import type { RenderFrame, Renderer } from '../types';

const MARGIN_PX = 24;
const PICK_RADIUS_PX = 12;

interface Palette {
  field: string;
  fieldLine: string;
  zone: string;
  fielder: string;
  fielderIdle: string;
  fielderDead: string;
  ball: string;
  shadow: string;
  landing: string;
  targetLine: string;
  selected: string;
  nearMiss: string;
  sensing: string;
}

export class TopDown2D implements Renderer {
  readonly element: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private lastFrame: RenderFrame | null = null;

  // View transform: canvas = origin + scale * (x, -y), in CSS pixels.
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private dpr = 1;
  private width = 0;
  private height = 0;

  private readonly landing = vec3();

  constructor() {
    this.element = document.createElement('canvas');
    this.element.className = 'topdown2d';
    const ctx = this.element.getContext('2d');
    if (ctx === null) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.element);
  }

  resize(): void {
    const rect = this.element.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.element.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.element.height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.lastFrame !== null) this.render(this.lastFrame);
  }

  pick(clientX: number, clientY: number): number | null {
    const frame = this.lastFrame;
    if (frame === null) return null;
    const rect = this.element.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const snap = frame.snapshot;
    let best: number | null = null;
    let bestDist = PICK_RADIUS_PX;
    for (let i = 0; i < snap.fielderCount; i++) {
      const cx = this.toCanvasX(snap.fielderPos[3 * i]);
      const cy = this.toCanvasY(snap.fielderPos[3 * i + 1]);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  dispose(): void {
    this.observer.disconnect();
  }

  render(frame: RenderFrame): void {
    this.lastFrame = frame;
    const snap = frame.snapshot;
    const ctx = this.ctx;
    const palette = this.readPalette();
    this.fitView(snap);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawField(snap, palette);
    this.drawZones(snap, palette);
    this.drawTargetLines(snap, palette);
    this.drawFielders(snap, palette, frame.selectedFielder);
    this.drawBalls(snap, palette);
  }

  private fitView(snap: WorldSnapshot): void {
    const { field, launch } = snap.config;
    let minX = -field.width / 2;
    let maxX = field.width / 2;
    let minY = -field.length / 2;
    let maxY = field.length / 2;
    for (const z of launch.zones) {
      minX = Math.min(minX, z.x - z.radius);
      maxX = Math.max(maxX, z.x + z.radius);
      minY = Math.min(minY, z.y - z.radius);
      maxY = Math.max(maxY, z.y + z.radius);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const usableW = Math.max(1, this.width - 2 * MARGIN_PX);
    const usableH = Math.max(1, this.height - 2 * MARGIN_PX);
    this.scale = Math.min(usableW / spanX, usableH / spanY);
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    this.originX = this.width / 2 - centreX * this.scale;
    this.originY = this.height / 2 + centreY * this.scale;
  }

  private toCanvasX(x: number): number {
    return this.originX + x * this.scale;
  }

  private toCanvasY(y: number): number {
    return this.originY - y * this.scale;
  }

  private drawField(snap: WorldSnapshot, p: Palette): void {
    const ctx = this.ctx;
    const { width, length } = snap.config.field;
    const x0 = this.toCanvasX(-width / 2);
    const y0 = this.toCanvasY(length / 2);
    ctx.fillStyle = p.field;
    ctx.fillRect(x0, y0, width * this.scale, length * this.scale);
    ctx.strokeStyle = p.fieldLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const stepM = 20;
    for (let x = -width / 2; x <= width / 2 + 1e-9; x += stepM) {
      ctx.moveTo(this.toCanvasX(x), y0);
      ctx.lineTo(this.toCanvasX(x), y0 + length * this.scale);
    }
    for (let y = -length / 2; y <= length / 2 + 1e-9; y += stepM) {
      ctx.moveTo(x0, this.toCanvasY(y));
      ctx.lineTo(x0 + width * this.scale, this.toCanvasY(y));
    }
    ctx.stroke();
  }

  private drawZones(snap: WorldSnapshot, p: Palette): void {
    const ctx = this.ctx;
    ctx.strokeStyle = p.zone;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    for (const z of snap.config.launch.zones) {
      ctx.beginPath();
      ctx.arc(
        this.toCanvasX(z.x),
        this.toCanvasY(z.y),
        Math.max(3, z.radius * this.scale),
        0,
        2 * Math.PI,
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawTargetLines(snap: WorldSnapshot, p: Palette): void {
    const ctx = this.ctx;
    const h = snap.config.catch.height;
    ctx.strokeStyle = p.targetLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < snap.fielderCount; i++) {
      const b = snap.fielderTargetBall[i];
      if (b < 0 || snap.ballState[b] !== BallState.FLYING) continue;
      const t = predictLandingAt(this.landing, snap.ballPos, snap.ballVel, b, h);
      if (Number.isNaN(t)) continue;
      ctx.moveTo(
        this.toCanvasX(snap.fielderPos[3 * i]),
        this.toCanvasY(snap.fielderPos[3 * i + 1]),
      );
      ctx.lineTo(this.toCanvasX(this.landing[0]), this.toCanvasY(this.landing[1]));
    }
    ctx.stroke();
  }

  private drawFielders(snap: WorldSnapshot, p: Palette, selected: number | null): void {
    const ctx = this.ctx;
    const r = Math.max(3, snap.config.collisions.bodyRadius * this.scale);
    for (let i = 0; i < snap.fielderCount; i++) {
      const cx = this.toCanvasX(snap.fielderPos[3 * i]);
      const cy = this.toCanvasY(snap.fielderPos[3 * i + 1]);
      if (snap.fielderAlive[i] === 0) {
        ctx.strokeStyle = p.fielderDead;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx - r, cy + r);
        ctx.lineTo(cx + r, cy - r);
        ctx.stroke();
        continue;
      }
      // Fielders chasing the same ball share a colour, so clumping is visible at a glance.
      const target = snap.fielderTargetBall[i];
      ctx.fillStyle = target >= 0 ? targetColour(target) : p.fielderIdle;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      if (snap.fielderNearMiss[i] === 1) {
        ctx.strokeStyle = p.nearMiss;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (i === selected) {
        ctx.strokeStyle = p.selected;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, 2 * Math.PI);
        ctx.stroke();
        // Sensing range (dashed) and separation radius (solid) of the selected fielder.
        ctx.strokeStyle = p.sensing;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(cx, cy, snap.config.sensing.range * this.scale, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, snap.config.strategy.separationRadius * this.scale, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }

  private drawBalls(snap: WorldSnapshot, p: Palette): void {
    const ctx = this.ctx;
    const h = snap.config.catch.height;
    const ringR = Math.max(4, snap.config.catch.radius * this.scale);
    for (let b = 0; b < snap.ballCount; b++) {
      if (snap.ballState[b] !== BallState.FLYING) continue;
      const x = snap.ballPos[3 * b];
      const y = snap.ballPos[3 * b + 1];
      const z = snap.ballPos[3 * b + 2];
      const cx = this.toCanvasX(x);
      const cy = this.toCanvasY(y);

      // Predicted landing ring.
      const t = predictLandingAt(this.landing, snap.ballPos, snap.ballVel, b, h);
      if (!Number.isNaN(t)) {
        ctx.strokeStyle = p.landing;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          this.toCanvasX(this.landing[0]),
          this.toCanvasY(this.landing[1]),
          ringR,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
      }

      // Ground shadow, then the ball scaled by height.
      ctx.fillStyle = p.shadow;
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = p.ball;
      ctx.beginPath();
      ctx.arc(cx, cy - Math.min(z, 40) * 0.15, 2.5 + Math.min(z, 40) * 0.08, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  private readPalette(): Palette {
    const style = getComputedStyle(this.element);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      field: read('--field', '#3f8f4a'),
      fieldLine: read('--field-line', 'rgba(255,255,255,0.25)'),
      zone: read('--zone', '#d08a2b'),
      fielder: read('--fielder', '#2f6fd6'),
      fielderIdle: read('--fielder-idle', '#8fb0e6'),
      fielderDead: read('--fielder-dead', '#888'),
      ball: read('--ball', '#f2f2f2'),
      shadow: read('--shadow', 'rgba(0,0,0,0.4)'),
      landing: read('--landing', 'rgba(255,255,255,0.7)'),
      targetLine: read('--target-line', 'rgba(255,255,255,0.35)'),
      selected: read('--accent', '#ffd23f'),
      nearMiss: read('--near-miss', '#e5484d'),
      sensing: read('--sensing', 'rgba(255,255,255,0.5)'),
    };
  }
}

/** A stable, well-spread hue per ball id. */
function targetColour(ballId: number): string {
  return `hsl(${(ballId * 47) % 360} 75% 55%)`;
}
