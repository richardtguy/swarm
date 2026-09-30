/**
 * InstancedMesh management: one draw call per entity type (CLAUDE.md section 12). Each layer
 * grows its instance buffer on demand and is refilled every frame.
 */
import {
  Color,
  InstancedMesh,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { toThree } from './coords';

const WHITE = new Color(1, 1, 1);

/** A growable instanced mesh for one entity type. */
export class InstanceLayer {
  private mesh: InstancedMesh | null = null;
  private capacity = 0;
  private count = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();

  /**
   * @param parent object the mesh is added to
   * @param geometry unit geometry, scaled per instance
   * @param material shared material; it should be white where `coloured` is true, since instance
   *   colours multiply it
   * @param coloured whether instances carry their own colour
   */
  constructor(
    private readonly parent: Object3D,
    private readonly geometry: BufferGeometry,
    readonly material: Material,
    private readonly coloured: boolean,
  ) {}

  /** Start filling a frame with at most `max` instances. */
  begin(max: number): void {
    if (this.mesh === null || max > this.capacity) this.grow(max);
    this.count = 0;
  }

  /**
   * Add the next instance at core position (x, y, z) (m), scaled by `horizontal` across the
   * ground and `vertical` upwards.
   */
  add(x: number, y: number, z: number, horizontal: number, vertical: number, color?: Color): void {
    const mesh = this.mesh;
    if (mesh === null || this.count >= this.capacity) return;
    toThree(this.position, x, y, z);
    this.matrix.makeScale(horizontal, vertical, horizontal).setPosition(this.position);
    mesh.setMatrixAt(this.count, this.matrix);
    if (this.coloured) mesh.setColorAt(this.count, color ?? WHITE);
    this.count++;
  }

  /** Finish the frame: only the instances added since `begin` are drawn. */
  end(): void {
    const mesh = this.mesh;
    if (mesh === null) return;
    mesh.count = this.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.removeMesh();
    this.geometry.dispose();
    this.material.dispose();
  }

  private grow(max: number): void {
    this.removeMesh();
    this.capacity = Math.max(16, max, 2 * this.capacity);
    const mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
    // Instances move every frame, so a cached bounding sphere would cull them wrongly.
    mesh.frustumCulled = false;
    mesh.count = 0;
    // Create the colour attribute up front so the material compiles with it once.
    if (this.coloured) mesh.setColorAt(0, WHITE);
    this.parent.add(mesh);
    this.mesh = mesh;
  }

  private removeMesh(): void {
    if (this.mesh === null) return;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = null;
  }
}
