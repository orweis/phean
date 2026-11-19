# Models

## avatar-sample-c.glb

The person at the top of the hill in the landing page's boulder scene (`src/components/marketing/hill/avatar-model.ts`).

- **Model:** AvatarSample_C, one of the sample avatars that ship with VRoid Studio.
- **Author:** VRoid Project, pixiv Inc.
- **Source:** VRoid Studio's sample models, as `AvatarSample_C.vrm` (VRM 0.x); fetched from the mirror at <https://github.com/madjin/vrm-samples> (`vroid/stable/AvatarSample_C.vrm`).
- **Licence:** not CC0. The model is used under VRoid's conditions of use for AvatarSample_A, B and C: <https://vroid.pixiv.help/hc/en-us/articles/4402394424089>. Copyright stays with pixiv; the conditions allow use, alteration and redistribution, commercial use included. Read them before reusing this file elsewhere.
- **Changes made:** converted to plain glTF and cut down for the web with glTF-Transform. The VRM extension, the thumbnail, the normal, emission and matcap maps, and all but three face morph targets (a smile, a smile with eyes shut, a blink) were removed; primitives that share a material were joined; colour maps were resized to 512px and re-encoded as WebP; geometry was quantized and packed with meshopt. The scene replaces the model's shading with its own.
