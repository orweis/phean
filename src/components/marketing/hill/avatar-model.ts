import { BackSide, Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, SkinnedMesh, type Material, type Object3D, type Texture } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AVATAR_BONES, AVATAR_FINGERS, makeAvatar, type Avatar, type AvatarBone, type AvatarHand } from "./avatar";

/*
 * Fetches the person's model and dresses it for the scene. It is VRoid's AvatarSample_C (see the
 * notice beside the file), cut down to what shows at this size: 512px colour maps, three faces,
 * meshopt-packed. It comes with its own flat (unlit) materials; here its skin, clothes and hair take
 * the scene's cel shading and ink line, as the bots do, and the features of the face stay unlit, as
 * on a cel. Fetched only by the scene, which is itself loaded only near the screen.
 */

export const AVATAR_URL = "/marketing/models/avatar-sample-c.glb";

export interface AvatarModel {
  /** What to put on the hill: its origin is between the feet, +x the way it faces. */
  root: Group;
  avatar: Avatar;
  /** The ink lines' materials and the phone's, for the theme to colour. */
  lines: MeshBasicMaterial[];
  phoneBody: MeshToonMaterial;
  phoneScreen: MeshToonMaterial;
  phone: Group;
  dispose(): void;
}

/** The face's features (eyes, brows, mouth, lashes) are drawn unlit; its skin is shaded with the body's. */
const FEATURE = /_(EYE|FACE)$/;

export async function loadAvatar(height: number, ramp: Texture): Promise<AvatarModel> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(AVATAR_URL);
  const model = gltf.scene;
  // The model faces -z; the scene's people face +x.
  model.rotation.y = -Math.PI / 2;
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const fit = height / (box.max.y - box.min.y);
  model.position.y = -box.min.y;
  const root = new Group();
  root.add(model);
  root.scale.setScalar(fit);

  const disposables: { dispose(): void }[] = [];
  const lines: MeshBasicMaterial[] = [];
  const faces: Mesh[] = [];
  const skinned: SkinnedMesh[] = [];
  const dressed = new Map<Material, Material>();
  const lined = new Map<Material, MeshBasicMaterial>();
  const width = (0.0105 / fit).toFixed(5);
  /** The model's own material, or the scene's cel shading with the same colour map. */
  const dress = (material: Material): Material => {
    const own = material as MeshBasicMaterial;
    disposables.push(own);
    if (own.map) disposables.push(own.map);
    if (FEATURE.test(own.name)) {
      // Toned to sit in the dusk with the lit skin around it.
      own.color.multiplyScalar(0.86);
      return own;
    }
    let toon = dressed.get(own);
    if (!toon) {
      toon = new MeshToonMaterial({ name: own.name, gradientMap: ramp, map: own.map, alphaTest: own.alphaTest, side: own.side });
      dressed.set(own, toon);
      disposables.push(toon);
    }
    return toon;
  };
  /** The ink line for a material: the shape again, swollen and inside out, cut where the colour map is clear. */
  const line = (material: Material): MeshBasicMaterial => {
    let made = lined.get(material);
    if (!made) {
      const from = material as MeshToonMaterial;
      made = new MeshBasicMaterial({ side: BackSide, map: from.map, alphaTest: from.alphaTest });
      made.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = position + normalize(normal) * ${width};`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#ifdef USE_MAP\n diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif");
      };
      lined.set(material, made);
      lines.push(made);
      disposables.push(made);
    }
    return made;
  };
  model.traverse((child) => {
    const mesh = child as SkinnedMesh;
    if (!mesh.isMesh) return;
    // Its bounds are the rest pose's; it is always on screen when the scene is.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    disposables.push(mesh.geometry);
    if (mesh.morphTargetDictionary) faces.push(mesh);
    mesh.material = dress(mesh.material as Material);
    if (mesh.isSkinnedMesh && mesh.material instanceof MeshToonMaterial) skinned.push(mesh);
  });
  for (const mesh of skinned) {
    const outline = new SkinnedMesh(mesh.geometry, line(mesh.material as Material));
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.frustumCulled = false;
    // The faces move the skin; the line moves with it.
    outline.morphTargetInfluences = mesh.morphTargetInfluences;
    outline.morphTargetDictionary = mesh.morphTargetDictionary;
    mesh.parent?.add(outline);
  }

  const bones = {} as Record<AvatarBone, Object3D>;
  for (const [bone, name] of Object.entries(AVATAR_BONES) as [AvatarBone, string][]) {
    const found = model.getObjectByName(name);
    if (!found) throw new Error(`The person's model has no bone ${name}`);
    bones[bone] = found;
  }

  const hand = (side: "R" | "L"): AvatarHand =>
    Object.fromEntries(AVATAR_FINGERS.map((finger) => [finger, [1, 2, 3].map((joint) => model.getObjectByName(`J_Bip_${side}_${finger}${joint}`)).filter((bone): bone is Object3D => Boolean(bone))]));
  const fingers = { right: hand("R"), left: hand("L") };

  // The phone: a dark slab with a lit screen on its +x face.
  const phone = new Group();
  const phoneBody = new MeshToonMaterial({ gradientMap: ramp });
  const phoneScreen = new MeshToonMaterial({ gradientMap: ramp });
  const slab = new BoxGeometry(0.016, 0.17, 0.09);
  const glass = new BoxGeometry(0.006, 0.152, 0.076);
  glass.translate(0.008, 0, 0);
  phone.add(new Mesh(slab, phoneBody), new Mesh(glass, phoneScreen));
  disposables.push(phoneBody, phoneScreen, slab, glass);

  return {
    root,
    avatar: makeAvatar({ root, bones, fingers, faces, phone }),
    lines,
    phoneBody,
    phoneScreen,
    phone,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
