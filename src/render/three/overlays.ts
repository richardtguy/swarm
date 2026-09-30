/**
 * Toggleable 3D overlays: ball arcs, landing rings, target lines, comms links, near-miss rings
 * and the selected fielder's rings. Every overlay is a single `LineSegments` whose buffer is
 * refilled each frame. The buffer-writing functions are pure so they can be tested in Node.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type ColorRepresentation,
} from 'three';
import { GRAVITY, predictLandingAt, timeToDescendThrough } from '../../core/physics/ballistics';
import type { WorldSnapshot } from '../../core/snapshot';
import { HashGrid } from '../../core/spatial/hashGrid';
import { BallState } from '../../core/state';
import { vec3 } from '../../core/vec3';
import { landingRingRadius } from '../landing';
import type { OverlaySettings } from '../types';
import { writeThree } from './coords';
import type { Paint, Palette3D } from './palette';

/** Line segments per ball arc. */
export const ARC_SEGMENTS = 20;
/** Line segments per circle. */
export const CIRCLE_SEGMENTS = 32;
/** Most comms links drawn at once, to avoid clutter (CLAUDE.md section 12). */
export const MAX_COMMS_LINKS = 1500;
/** Height (m) at which ground overlays are drawn, just above the field to avoid z-fighting. */
const GROUND_Z = 0.05;

/**
 * Write the remaining ballistic path of a ball at position `p` (m) with velocity `v` (m/s),
 * until it descends through height `zEnd` (m), as `segments` line segments starting at vertex
 * `vertex` of `out`. Returns the number of vertices written (0 if it never reaches `zEnd`).
 */
export function writeArc(
  out: Float32Array,
  vertex: number,
  p: ArrayLike<number>,
  v: ArrayLike<number>,
  zEnd: number,
  segments: number,
): number {
  const duration = timeToDescendThrough(p[2], v[2], zEnd);
  if (!(duration > 0)) return 0;
  let k = vertex;
  for (let s = 0; s < segments; s++) {
    for (const t of [(s / segments) * duration, ((s + 1) / segments) * duration]) {
      const z = p[2] + v[2] * t - 0.5 * GRAVITY * t * t;
      writeThree(out, k++, p[0] + v[0] * t, p[1] + v[1] * t, z);
    }
  }
  return k - vertex;
}

/**
 * Write a horizontal circle of radius `r` (m) centred on core point (cx, cy, z) as `segments`
 * line segments starting at vertex `vertex` of `out`. Returns the number of vertices written.
 */
export function writeCircle(
  out: Float32Array,
  vertex: number,
  cx: number,
  cy: number,
  z: number,
  r: number,
  segments: number,
): number {
  let k = vertex;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * 2 * Math.PI;
    const a1 = ((s + 1) / segments) * 2 * Math.PI;
    writeThree(out, k++, cx + r * Math.cos(a0), cy + r * Math.sin(a0), z);
    writeThree(out, k++, cx + r * Math.cos(a1), cy + r * Math.sin(a1), z);
  }
  return k - vertex;
}

/** One LineSegments object with a growable position buffer. */
class LineLayer {
  readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>;
  private positions = new Float32Array(0);

  constructor() {
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ transparent: true, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  paint(p: Paint): void {
    this.lines.material.color.copy(p.color);
    this.lines.material.opacity = p.opacity;
  }

  /** A buffer with room for at least `vertices` vertices. */
  reserve(vertices: number): Float32Array {
    if (3 * vertices > this.positions.length) {
      this.positions = new Float32Array(Math.max(3 * vertices, 2 * this.positions.length, 96));
      this.lines.geometry.dispose();
      this.lines.geometry = new BufferGeometry();
      this.lines.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    }
    return this.positions;
  }

  /** Draw the first `vertices` vertices written since the last `reserve`. */
  commit(vertices: number): void {
    const attr = this.lines.geometry.getAttribute('position');
    if (attr !== undefined) attr.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, vertices);
    this.lines.visible = vertices > 0;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}

/** All overlay layers, refilled from a snapshot each frame. */
export class Overlays {
  readonly group = new Group();
  private readonly arcs = new LineLayer();
  private readonly rings = new LineLayer();
  private readonly targets = new LineLayer();
  private readonly comms = new LineLayer();
  private readonly nearMiss = new LineLayer();
  private readonly selected = new LineLayer();
  private readonly selectedRanges = new LineLayer();
  private grid: HashGrid | null = null;
  private gridBuffer = new Int32Array(0);
  private readonly landing = vec3();

  constructor(palette: Palette3D) {
    for (const layer of this.layers()) this.group.add(layer.lines);
    this.applyPalette(palette);
  }

  applyPalette(p: Palette3D): void {
    this.arcs.paint(p.arc);
    this.rings.paint(p.landing);
    this.targets.paint(p.targetLine);
    this.comms.paint(p.commsLink);
    this.nearMiss.paint(p.nearMiss);
    this.selected.paint(p.selected);
    this.selectedRanges.paint(p.sensing);
  }

  /**
   * Refill every enabled overlay from `snap`. `fielderRadius` (m) is the drawn fielder radius, so
   * rings sit just outside the fielder bodies.
   */
  update(
    snap: WorldSnapshot,
    settings: Readonly<OverlaySettings>,
    selected: number | null,
    fielderRadius: number,
  ): void {
    const { config } = snap;
    const h = config.catch.height;
    let flying = 0;
    for (let b = 0; b < snap.ballCount; b++) if (snap.ballState[b] === BallState.FLYING) flying++;

    // Ball arcs and landing rings.
    let nArcs = 0;
    let nRings = 0;
    const arcBuf = settings.arcs ? this.arcs.reserve(flying * ARC_SEGMENTS * 2) : null;
    const ringBuf = settings.landingRings ? this.rings.reserve(flying * CIRCLE_SEGMENTS * 2) : null;
    if (arcBuf !== null || ringBuf !== null) {
      for (let b = 0; b < snap.ballCount; b++) {
        if (snap.ballState[b] !== BallState.FLYING) continue;
        const p = snap.ballPos.subarray(3 * b, 3 * b + 3);
        const v = snap.ballVel.subarray(3 * b, 3 * b + 3);
        if (arcBuf !== null) nArcs += writeArc(arcBuf, nArcs, p, v, 0, ARC_SEGMENTS);
        if (ringBuf !== null) {
          const t = predictLandingAt(this.landing, snap.ballPos, snap.ballVel, b, h);
          if (Number.isNaN(t)) continue;
          const r = landingRingRadius(config.catch.radius, config.sensing.noise, t);
          const [lx, ly] = this.landing;
          nRings += writeCircle(ringBuf, nRings, lx, ly, h, r, CIRCLE_SEGMENTS);
        }
      }
    }
    this.arcs.commit(nArcs);
    this.rings.commit(nRings);

    // Target lines: fielder → landing point of the pursued ball.
    let nTargets = 0;
    if (settings.targetLines) {
      const buf = this.targets.reserve(snap.fielderCount * 2);
      for (let i = 0; i < snap.fielderCount; i++) {
        const b = snap.fielderTargetBall[i];
        if (b < 0 || snap.fielderAlive[i] === 0 || snap.ballState[b] !== BallState.FLYING) {
          continue;
        }
        if (Number.isNaN(predictLandingAt(this.landing, snap.ballPos, snap.ballVel, b, h))) {
          continue;
        }
        const o = 3 * i;
        writeThree(buf, nTargets++, snap.fielderPos[o], snap.fielderPos[o + 1], GROUND_Z);
        writeThree(buf, nTargets++, this.landing[0], this.landing[1], GROUND_Z);
      }
    }
    this.targets.commit(nTargets);

    this.comms.commit(settings.commsLinks ? this.writeComms(snap, selected) : 0);

    // Near-miss rings.
    let nNear = 0;
    if (settings.nearMisses) {
      let flagged = 0;
      for (let i = 0; i < snap.fielderCount; i++) flagged += snap.fielderNearMiss[i];
      const buf = this.nearMiss.reserve(flagged * CIRCLE_SEGMENTS * 2);
      for (let i = 0; i < snap.fielderCount; i++) {
        if (snap.fielderNearMiss[i] === 0 || snap.fielderAlive[i] === 0) continue;
        const [x, y] = [snap.fielderPos[3 * i], snap.fielderPos[3 * i + 1]];
        nNear += writeCircle(buf, nNear, x, y, GROUND_Z, fielderRadius + 0.4, CIRCLE_SEGMENTS);
      }
    }
    this.nearMiss.commit(nNear);

    // Selected fielder: highlight ring, then sensing range and separation radius.
    let nSel = 0;
    let nRanges = 0;
    if (selected !== null && selected < snap.fielderCount) {
      const [x, y] = [snap.fielderPos[3 * selected], snap.fielderPos[3 * selected + 1]];
      const sel = this.selected.reserve(CIRCLE_SEGMENTS * 2);
      nSel = writeCircle(sel, 0, x, y, GROUND_Z, fielderRadius + 0.9, CIRCLE_SEGMENTS);
      // The sensing circle is large, so it gets more segments than the separation circle.
      const ranges = this.selectedRanges.reserve(5 * CIRCLE_SEGMENTS * 2);
      const sensing = config.sensing.range;
      nRanges += writeCircle(ranges, nRanges, x, y, GROUND_Z, sensing, 4 * CIRCLE_SEGMENTS);
      const sep = config.strategy.separationRadius;
      if (sep > 0) nRanges += writeCircle(ranges, nRanges, x, y, GROUND_Z, sep, CIRCLE_SEGMENTS);
    }
    this.selected.commit(nSel);
    this.selectedRanges.commit(nRanges);
  }

  dispose(): void {
    for (const layer of this.layers()) layer.dispose();
  }

  /**
   * Links between alive fielders within comms range, found with the core hash grid. With a
   * fielder selected, only its links are drawn; otherwise all pairs up to `MAX_COMMS_LINKS`.
   * Returns vertices written.
   */
  private writeComms(snap: WorldSnapshot, selected: number | null): number {
    const n = snap.fielderCount;
    const range = snap.config.comms.range;
    if (n === 0 || !(range > 0)) return 0;
    if (this.grid === null || this.grid.capacity < n || this.grid.cellSize !== range) {
      this.grid = new HashGrid(range, n);
      this.gridBuffer = new Int32Array(n);
    }
    this.grid.build(snap.fielderPos, n, snap.fielderAlive);
    const buf = this.comms.reserve(MAX_COMMS_LINKS * 2);
    const pos = snap.fielderPos;
    let k = 0;
    const from = selected !== null && selected < n ? selected : 0;
    const to = selected !== null && selected < n ? selected + 1 : n;
    for (let i = from; i < to && k < MAX_COMMS_LINKS * 2; i++) {
      if (snap.fielderAlive[i] === 0) continue;
      const found = this.grid.query(pos[3 * i], pos[3 * i + 1], range, this.gridBuffer);
      for (let q = 0; q < found && k < MAX_COMMS_LINKS * 2; q++) {
        const j = this.gridBuffer[q];
        // Each pair once, unless only the selected fielder's links are wanted.
        if (j === i || (selected === null && j < i)) continue;
        writeThree(buf, k++, pos[3 * i], pos[3 * i + 1], GROUND_Z + 0.5);
        writeThree(buf, k++, pos[3 * j], pos[3 * j + 1], GROUND_Z + 0.5);
      }
    }
    return k;
  }

  private layers(): LineLayer[] {
    return [
      this.arcs,
      this.rings,
      this.targets,
      this.comms,
      this.nearMiss,
      this.selected,
      this.selectedRanges,
    ];
  }
}

/** Build a static LineSegments from a filled position buffer, e.g. field markings. */
export function staticLines(
  positions: Float32Array,
  color: ColorRepresentation,
  opacity: number,
): LineSegments<BufferGeometry, LineBasicMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }),
  );
  lines.frustumCulled = false;
  return lines;
}
