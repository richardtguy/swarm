/**
 * Camera presets wrapped around three.js's own OrbitControls, which handle mouse and touch:
 * one finger or left-drag orbits, two fingers or wheel zoom, right-drag or two-finger drag pans.
 *
 * - top-down: straight down over the field, north at the top of the screen;
 * - stadium: a low oblique view from behind the launch side;
 * - follow: keeps the selected fielder centred while the user orbits around it.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fromThree, toThree } from './coords';

export type CameraPreset = 'top-down' | 'stadium' | 'follow';

export const CAMERA_PRESETS: readonly CameraPreset[] = ['top-down', 'stadium', 'follow'];

/** Ground-plane extent (m, core frame) that the top-down and stadium presets frame. */
export interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Stadium view elevation above the horizon. */
const STADIUM_ELEVATION = MathUtils.degToRad(22);
/** Follow view offset from the fielder: back (south) and up, in metres. */
const FOLLOW_BACK = 22;
const FOLLOW_UP = 16;

export class CameraRig {
  readonly controls: OrbitControls;
  private current: CameraPreset = 'stadium';
  private followId: number | null = null;
  private readonly centre = new Vector3();
  private readonly delta = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    const controls = new OrbitControls(camera, dom);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false; // pan across the ground, not the screen
    controls.maxPolarAngle = MathUtils.degToRad(88); // never below the ground
    controls.minDistance = 3;
    controls.maxDistance = 1500;
    this.controls = controls;
  }

  get preset(): CameraPreset {
    return this.current;
  }

  /**
   * Switch preset. Top-down and stadium frame `bounds`; follow waits for a fielder to follow
   * (see `update`).
   */
  setPreset(preset: CameraPreset, bounds: Readonly<SceneBounds>): void {
    this.current = preset;
    this.followId = null;
    if (preset === 'follow') return;

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    toThree(this.centre, cx, cy, 0);
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const vFov = MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);

    if (preset === 'top-down') {
      const d = 1.08 * Math.max(spanY / 2 / Math.tan(vFov / 2), spanX / 2 / Math.tan(hFov / 2));
      // A hair south of vertical so "up" on screen is north and the controls are not degenerate.
      toThree(this.camera.position, cx, cy - d * 1e-3, d);
    } else {
      // Seen from a low angle the north–south depth is foreshortened by sin(elevation), so the
      // field's width usually decides how far back the camera sits.
      const depth = spanY * Math.sin(STADIUM_ELEVATION);
      const d = 1.3 * Math.max(spanX / 2 / Math.tan(hFov / 2), depth / 2 / Math.tan(vFov / 2));
      const back = d * Math.cos(STADIUM_ELEVATION);
      toThree(this.camera.position, cx, cy - back, d * Math.sin(STADIUM_ELEVATION));
    }
    this.controls.target.copy(this.centre);
    this.controls.update();
  }

  /**
   * Call once per frame. In follow mode, `followPoint` is the three.js position of fielder
   * `followId`; the camera jumps to it when the fielder changes, then moves with it while
   * keeping whatever orbit the user has chosen.
   */
  update(followPoint: Readonly<Vector3> | null, followId: number | null): void {
    if (this.current === 'follow') {
      if (followPoint === null || followId === null) {
        this.followId = null;
      } else if (followId !== this.followId) {
        this.followId = followId;
        this.controls.target.copy(followPoint);
        const [x, y] = fromThree(followPoint);
        toThree(this.camera.position, x, y - FOLLOW_BACK, FOLLOW_UP);
      } else {
        this.delta.subVectors(followPoint, this.controls.target);
        this.controls.target.add(this.delta);
        this.camera.position.add(this.delta);
      }
    }
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
