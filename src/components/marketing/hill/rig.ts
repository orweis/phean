import { BufferGeometry, Euler, Matrix4, Mesh, Quaternion, Vector3, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/*
 * What the bots and the person share: bodies built from a few primitives, merged per material so a
 * figure is a handful of draw calls, and limbs of two segments that bend at a knee or an elbow to
 * put a hand or a foot where the pose asks.
 */

const UP = new Vector3(0, 1, 0);
const scratch = new Vector3();
const along = new Vector3();
const side = new Vector3();

/** Collects shapes by material, then merges each material's shapes into one geometry. */
export class Parts<Slot extends string> {
  private shapes = new Map<Slot, BufferGeometry[]>();

  /** Adds a geometry (taken over: it is moved, merged and disposed of) at a place. */
  add(slot: Slot, geometry: BufferGeometry, position: [number, number, number] = [0, 0, 0], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    const matrix = new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale));
    const placed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (placed !== geometry) geometry.dispose();
    placed.applyMatrix4(matrix);
    // Only what every primitive has, so they merge.
    for (const name of Object.keys(placed.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") placed.deleteAttribute(name);
    const list = this.shapes.get(slot) ?? [];
    list.push(placed);
    this.shapes.set(slot, list);
    return this;
  }

  /** One merged geometry per material slot. */
  build(): Map<Slot, BufferGeometry> {
    const built = new Map<Slot, BufferGeometry>();
    for (const [slot, list] of this.shapes) {
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list);
      if (list.length > 1) for (const item of list) item.dispose();
      built.set(slot, merged);
    }
    this.shapes.clear();
    return built;
  }
}

/** Adds a mesh for every slot that has a material. */
export function meshes<Slot extends string>(parent: Object3D, geometries: Map<Slot, BufferGeometry>, materials: Record<Slot, Material>): Mesh[] {
  const made: Mesh[] = [];
  for (const [slot, geometry] of geometries) {
    const mesh = new Mesh(geometry, materials[slot]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    made.push(mesh);
  }
  return made;
}

/** Lays a segment modelled along +Y, centred on its middle, from `from` to `to`. */
export function span(mesh: Object3D, from: Vector3, to: Vector3) {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  along.copy(to).sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(UP, along);
}

/**
 * A two-segment limb from `root` towards `target`: writes where the joint (elbow, knee) and the end
 * (wrist, ankle) sit. The limb bends towards `pole`; a target out of reach is met as far as it goes.
 */
export function bend(root: Vector3, target: Vector3, upper: number, lower: number, pole: Vector3, joint: Vector3, end: Vector3) {
  along.copy(target).sub(root);
  const wanted = along.length() || 1e-4;
  const reach = Math.min(upper + lower - 1e-3, Math.max(Math.abs(upper - lower) + 1e-3, wanted));
  along.multiplyScalar(1 / wanted);
  end.copy(root).addScaledVector(along, reach);
  const toJoint = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(0, upper * upper - toJoint * toJoint));
  side.copy(pole).addScaledVector(along, -pole.dot(along));
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize();
  joint.copy(root).addScaledVector(along, toJoint).addScaledVector(side, out);
}

/** a + (b - a) * t, into `out`. */
export function mix(out: Vector3, a: Vector3, b: Vector3, t: number): Vector3 {
  return out.copy(a).lerp(b, t);
}

export function v(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

export { scratch };
