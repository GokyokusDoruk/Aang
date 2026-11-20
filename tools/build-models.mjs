import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample, weld, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder } from 'meshoptimizer';
import { meshopt } from '@gltf-transform/functions';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
// Quaternius paketlerinden (CC0) oyunun kullandığı küçültülmüş GLB'leri üretir.
// Kullanım (proje bağımlılığı değil, ayrı kurulur):
//   npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions sharp meshoptimizer
//   node tools/build-models.mjs "<UBC Standard>/Base Characters/Godot - UE/" "<UAL Standard>/Unreal-Godot/UAL1_Standard.glb" public/models
// Not: UBC glTF dosyası *_png.png adlı normal dokularını arar; eksikse T_Hair_1_Normal.png ve T_Eye_Normal.png'yi bu adlarla kopyalayın.
const [B, U, OUT] = process.argv.slice(2);

// Character
const doc = await io.read(B+'Superhero_Male_FullBody.gltf');
for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null); m.setMetallicRoughnessTexture(null); m.setOcclusionTexture(null);
}
await doc.transform(prune(), dedup(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT+'/character.glb', doc);

// Animations: only needed clips, no mesh
const KEEP = ['Idle_Loop','Jog_Fwd_Loop','Sprint_Loop','Jump_Start','Jump_Loop','Jump_Land','Roll','Crouch_Fwd_Loop','Punch_Cross','Punch_Jab','Spell_Simple_Shoot','Spell_Simple_Idle_Loop','Hit_Chest','Walk_Loop'];
const a = await io.read(U);
for (const an of a.getRoot().listAnimations()) if (!KEEP.includes(an.getName())) an.dispose();
for (const n of a.getRoot().listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setSkin(null); }
for (const m of a.getRoot().listMeshes()) m.dispose();
for (const s of a.getRoot().listSkins()) s.dispose();
for (const an of a.getRoot().listAnimations()) for (const ch of an.listChannels()) {
  const n = ch.getTargetNode();
  if (n && /(index|middle|pinky|ring|thumb)_|leaf/.test(n.getName())) { ch.getSampler()?.dispose(); ch.dispose(); }
}
await a.transform(resample({ tolerance: 0.002 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT+'/animations.glb', a);
console.log(a.getRoot().listAnimations().map(x=>x.getName()).join(','));
