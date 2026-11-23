import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

// Quaternius Universal Animation Library 1 + 2 (CC0) paketlerinden oyunun kullandığı klipleri
// mesh'siz, parmak kanalları atılmış, sıkıştırılmış GLB'lere ayırır.
// Kullanım (proje bağımlılığı değil, ayrı kurulur):
//   npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
//   node tools/build-anims.mjs "<UAL1>/Unreal-Godot/UAL1_Standard.glb" "<UAL2>/Unreal-Godot/UAL2_Standard.glb" public/models
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const [U1, U2, OUT] = process.argv.slice(2);

const KEEP1 = [
  // hareket
  'Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Walk_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop',
  // dövüş / büyü
  'Punch_Cross', 'Punch_Jab', 'Spell_Simple_Enter', 'Spell_Simple_Shoot', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop',
  'Pistol_Shoot', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up',
  // tepki / durum
  'Hit_Chest', 'Hit_Head', 'Swim_Idle_Loop',
];
const KEEP2 = [
  'OverhandThrow', 'Melee_Hook', 'Shield_OneShot', 'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Heavy_Combo',
  'LayToIdle', 'Hit_Knockback', 'NinjaJump_Start', 'NinjaJump_Idle_Loop', 'NinjaJump_Land',
];

async function build(src, keep, out) {
  const a = await io.read(src);
  for (const an of a.getRoot().listAnimations()) if (!keep.includes(an.getName())) an.dispose();
  for (const n of a.getRoot().listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setSkin(null); }
  for (const m of a.getRoot().listMeshes()) m.dispose();
  for (const s of a.getRoot().listSkins()) s.dispose();
  for (const an of a.getRoot().listAnimations()) for (const ch of an.listChannels()) {
    const n = ch.getTargetNode();
    if (n && /(index|middle|pinky|ring|thumb)_|leaf/.test(n.getName())) { ch.getSampler()?.dispose(); ch.dispose(); }
  }
  await a.transform(resample({ tolerance: 0.002 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(out, a);
  const names = a.getRoot().listAnimations().map((x) => x.getName());
  const missing = keep.filter((k) => !names.includes(k));
  console.log(out, names.length, missing.length ? `EKSİK: ${missing}` : 'tamam');
}

await build(U1, KEEP1, OUT + '/animations.glb');
await build(U2, KEEP2, OUT + '/animations2.glb');
