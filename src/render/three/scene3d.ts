/**
 * three.js renderer. Implements the same `Renderer` interface as the 2D view.
 *
 * Fielders, balls and ball shadows are instanced meshes, one draw call each. Static field
 * geometry is rebuilt only when the field or launch zones change. Colours come from the same CSS
 * custom properties as the 2D view and follow the light or dark theme.
 *
 * Display sizes: at true scale (0.4 m fielders, fist-sized balls on a 120 m field) nothing would
 * be visible, so bodies are drawn enlarged by the factors below. Positions are never scaled.
 */
import {
  Color,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import type { SimConfig } from '../../core/config';
import { BallState } from '../../core/state';
import { TARGET_LIGHTNESS, TARGET_SATURATION, targetHue } from '../colours';
import type { RenderFrame, Renderer } from '../types';
import { CameraRig, type CameraPreset, type SceneBounds } from './cameraRig';
import { layFlat, toThree, writeThree } from './coords';
import { InstanceLayer } from './instancing';
import { CIRCLE_SEGMENTS, Overlays, staticLines, writeCircle } from './overlays';
import { readPalette3D, type Palette3D } from './palette';

/** Drawn fielder radius as a multiple of the physical body radius. */
const FIELDER_DISPLAY_SCALE = 2;
/** Drawn fielder height (m). */
const FIELDER_HEIGHT = 2.2;
/** Drawn ball radius (m). */
const BALL_RADIUS = 0.5;
/** Field marking spacing (m), matching the 2D view. */
const GRID_STEP = 20;
const PICK_RADIUS_PX = 16;

export class Scene3D implements Renderer {
  readonly element: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.5, 4000);
  private readonly rig: CameraRig;
  private readonly staticGroup = new Group();
  private readonly fielders: InstanceLayer;
  private readonly balls: InstanceLayer;
  private readonly shadows: InstanceLayer;
  private readonly overlays: Overlays;
  private palette: Palette3D;

  private staticKey = '';
  private bounds: SceneBounds | null = null;
  private presetDue = true;
  private pendingPreset: CameraPreset = 'stadium';
  private lastFrame: RenderFrame | null = null;
  private width = 1;
  private height = 1;

  private readonly observer: ResizeObserver;
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly onThemeChange = (): void => this.applyPalette();
  private readonly color = new Color();
  private readonly point = new Vector3();

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.element = this.renderer.domElement;
    this.element.className = 'scene3d';
    this.palette = readPalette3D(document.documentElement);

    const sky = new HemisphereLight(0xffffff, 0x404840, 1.6);
    const sun = new DirectionalLight(0xffffff, 1.8);
    toThree(sun.position, -60, -80, 150);
    this.scene.add(sky, sun, this.staticGroup);

    const bodies = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    const fielderGeometry = new CylinderGeometry(1, 1, 1, 18);
    fielderGeometry.translate(0, 0.5, 0); // base on the ground; three's +y is core up
    this.fielders = new InstanceLayer(this.scene, fielderGeometry, bodies, true);
    this.balls = new InstanceLayer(
      this.scene,
      new SphereGeometry(1, 14, 10),
      new MeshStandardMaterial({ roughness: 0.35 }),
      false,
    );
    this.shadows = new InstanceLayer(
      this.scene,
      layFlat(new CircleGeometry(1, 20)),
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
      false,
    );
    this.overlays = new Overlays(this.palette);
    this.scene.add(this.overlays.group);
    this.applyPalette();

    this.rig = new CameraRig(this.camera, this.element);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.element);
    this.media.addEventListener('change', this.onThemeChange);
  }

  /** The active camera preset. */
  get cameraPreset(): CameraPreset {
    return this.pendingPreset;
  }

  /** Switch camera preset; applied on the next frame. */
  setCameraPreset(preset: CameraPreset): void {
    this.pendingPreset = preset;
    this.presetDue = true;
  }

  resize(): void {
    const rect = this.element.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.lastFrame !== null) this.render(this.lastFrame);
  }

  pick(clientX: number, clientY: number): number | null {
    const frame = this.lastFrame;
    if (frame === null) return null;
    const rect = this.element.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const snap = frame.snapshot;
    const lift = FIELDER_HEIGHT / 2; // aim at the middle of the body
    let best: number | null = null;
    let bestDist = PICK_RADIUS_PX;
    for (let i = 0; i < snap.fielderCount; i++) {
      toThree(this.point, snap.fielderPos[3 * i], snap.fielderPos[3 * i + 1], lift);
      this.point.project(this.camera);
      if (this.point.z > 1) continue; // behind the camera
      const sx = ((this.point.x + 1) / 2) * this.width;
      const sy = ((1 - this.point.y) / 2) * this.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  render(frame: RenderFrame): void {
    this.lastFrame = frame;
    const snap = frame.snapshot;
    this.syncStatic(snap.config);
    if (this.presetDue && this.bounds !== null) {
      this.rig.setPreset(this.pendingPreset, this.bounds);
      this.presetDue = false;
    }

    const radius = snap.config.collisions.bodyRadius * FIELDER_DISPLAY_SCALE;
    const p = this.palette;
    this.fielders.begin(snap.fielderCount);
    for (let i = 0; i < snap.fielderCount; i++) {
      const [x, y] = [snap.fielderPos[3 * i], snap.fielderPos[3 * i + 1]];
      if (snap.fielderAlive[i] === 0) {
        this.fielders.add(x, y, 0, radius, 0.2, p.fielderDead.color);
        continue;
      }
      const target = snap.fielderTargetBall[i];
      const colour =
        target < 0
          ? p.fielderIdle.color
          : frame.overlays.targetColours
            ? this.color.setHSL(
                targetHue(target) / 360,
                TARGET_SATURATION,
                TARGET_LIGHTNESS,
                SRGBColorSpace,
              )
            : p.fielder.color;
      this.fielders.add(x, y, 0, radius, FIELDER_HEIGHT, colour);
    }
    this.fielders.end();

    this.balls.begin(snap.ballCount);
    this.shadows.begin(snap.ballCount);
    for (let b = 0; b < snap.ballCount; b++) {
      if (snap.ballState[b] !== BallState.FLYING) continue;
      const [x, y, z] = [snap.ballPos[3 * b], snap.ballPos[3 * b + 1], snap.ballPos[3 * b + 2]];
      this.balls.add(x, y, z, BALL_RADIUS, BALL_RADIUS);
      // Shadows shrink as the ball climbs, which helps read height from above.
      const shadow = BALL_RADIUS * (1.6 - Math.min(z, 40) / 50);
      this.shadows.add(x, y, 0.03, shadow, 1);
    }
    this.balls.end();
    this.shadows.end();

    this.overlays.update(snap, frame.overlays, frame.selectedFielder, radius);

    const sel = frame.selectedFielder;
    const following = sel !== null && sel < snap.fielderCount;
    if (following) toThree(this.point, snap.fielderPos[3 * sel], snap.fielderPos[3 * sel + 1], 0);
    this.rig.update(following ? this.point : null, following ? sel : null);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.media.removeEventListener('change', this.onThemeChange);
    this.rig.dispose();
    this.clearStatic();
    this.fielders.dispose();
    this.balls.dispose();
    this.shadows.dispose();
    this.overlays.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers allow only a few live WebGL contexts
  }

  /** Re-read theme colours and apply them to every material. */
  private applyPalette(): void {
    this.palette = readPalette3D(document.documentElement);
    const p = this.palette;
    this.scene.background = p.background.color.clone();
    const ball = this.balls.material as MeshStandardMaterial;
    ball.color.copy(p.ball.color);
    ball.emissive.copy(p.ball.color).multiplyScalar(0.25);
    const shadow = this.shadows.material as MeshBasicMaterial;
    shadow.color.copy(p.shadow.color);
    shadow.opacity = p.shadow.opacity;
    this.overlays.applyPalette(p);
    this.staticKey = ''; // rebuild field markings in the new colours
  }

  /** Rebuild the field, markings and launch zones when they change. */
  private syncStatic(config: Readonly<SimConfig>): void {
    const key = JSON.stringify([config.field, config.launch.zones]);
    if (key === this.staticKey) return;
    const first = this.staticKey === '' && this.bounds === null;
    this.staticKey = key;
    this.clearStatic();
    const p = this.palette;
    const { width, length } = config.field;

    const field = new Mesh(
      layFlat(new PlaneGeometry(width, length)),
      new MeshStandardMaterial({
        color: p.field.color,
        roughness: 0.95,
        polygonOffset: true, // keep markings drawn on top of the grass
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    this.staticGroup.add(field);

    const lines: number[][] = [];
    for (let x = -width / 2; x <= width / 2 + 1e-9; x += GRID_STEP) {
      lines.push([x, -length / 2, x, length / 2]);
    }
    for (let y = -length / 2; y <= length / 2 + 1e-9; y += GRID_STEP) {
      lines.push([-width / 2, y, width / 2, y]);
    }
    const grid = new Float32Array(lines.length * 6);
    lines.forEach(([x0, y0, x1, y1], k) => {
      writeThree(grid, 2 * k, x0, y0, 0.02);
      writeThree(grid, 2 * k + 1, x1, y1, 0.02);
    });
    this.staticGroup.add(staticLines(grid, p.fieldLine.color, p.fieldLine.opacity));

    const zones = config.launch.zones;
    const zoneBuf = new Float32Array(zones.length * CIRCLE_SEGMENTS * 2 * 3);
    let k = 0;
    for (const z of zones) {
      k += writeCircle(zoneBuf, k, z.x, z.y, 0.04, Math.max(z.radius, 1), CIRCLE_SEGMENTS);
    }
    this.staticGroup.add(staticLines(zoneBuf, p.zone.color, 1));

    let minX = -width / 2;
    let maxX = width / 2;
    let minY = -length / 2;
    let maxY = length / 2;
    for (const z of zones) {
      minX = Math.min(minX, z.x - z.radius);
      maxX = Math.max(maxX, z.x + z.radius);
      minY = Math.min(minY, z.y - z.radius);
      maxY = Math.max(maxY, z.y + z.radius);
    }
    const changed =
      this.bounds === null ||
      this.bounds.minX !== minX ||
      this.bounds.maxX !== maxX ||
      this.bounds.minY !== minY ||
      this.bounds.maxY !== maxY;
    this.bounds = { minX, maxX, minY, maxY };
    // Re-frame when the field itself changes, but not on a theme change.
    if ((first || changed) && this.pendingPreset !== 'follow') this.presetDue = true;
  }

  private clearStatic(): void {
    for (const child of [...this.staticGroup.children]) {
      this.staticGroup.remove(child);
      disposeObject(child);
    }
  }
}

function disposeObject(object: Object3D): void {
  const withResources = object as Object3D & {
    geometry?: { dispose(): void };
    material?: { dispose(): void };
  };
  withResources.geometry?.dispose();
  withResources.material?.dispose();
}
