import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { AirSystem } from '../combat/AirSystem';
import type { Combatant } from '../combat/Combatant';
import type { Vfx } from './Vfx';
import { funnelGeometry, funnelMaterial, windBallMaterial } from './WindMaterial';

const DUST_0 = new THREE.Color(0x8f8170);
const DUST_1 = new THREE.Color(0xbcae98);
const WIND_0 = new THREE.Color(0xffffff);
const WIND_1 = new THREE.Color(0xbfe6ff);

/**
 * Hortum: kıvrılan, sarmal akan toz + hava hunisi (iki katman), çevresinde yükselen toz sarmalı ve tabanda toz.
 * Rüzgar küresi: yumuşak kenarlı, içinde fırtına bulutları dönen top + içinde dolaşan rüzgar parçacıkları. Çizgi yok.
 */
export class AirView {
  private readonly tornados = new Map<number, { group: THREE.Group; mats: THREE.ShaderMaterial[] }>();
  private readonly spheres = new Map<string, { group: THREE.Group; mats: THREE.ShaderMaterial[] }>();
  private readonly funnelOuter: THREE.BufferGeometry;
  private readonly funnelInner: THREE.BufferGeometry;
  private readonly ballGeo = new THREE.SphereGeometry(1, 40, 28);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: AirSystem,
    private readonly vfx: Vfx | null = null,
  ) {
    const T = GameConfig.air.tornado;
    this.funnelOuter = funnelGeometry(0.35, T.radius * 1.5, T.height * 1.5);
    this.funnelInner = funnelGeometry(0.2, T.radius * 1.05, T.height * 1.45);
  }

  update(dt: number, alpha: number, combatants: Combatant[]): void {
    const time = performance.now() / 1000;
    this.updateTornados(dt, alpha, time);
    this.updateSpheres(dt, alpha, combatants, time);
  }

  private updateTornados(dt: number, alpha: number, time: number): void {
    const T = GameConfig.air.tornado;
    const H = T.height * 1.5;
    const seen = new Set<number>();
    for (const t of this.system.tornados) {
      seen.add(t.id);
      let v = this.tornados.get(t.id);
      if (!v) {
        const group = new THREE.Group();
        const mo = funnelMaterial(true);
        const mi = funnelMaterial(false);
        mo.uniforms.uHeight.value = H;
        mi.uniforms.uHeight.value = H;
        group.add(new THREE.Mesh(this.funnelOuter, mo), new THREE.Mesh(this.funnelInner, mi));
        this.scene.add(group);
        v = { group, mats: [mo, mi] };
        this.tornados.set(t.id, v);
      }
      v.group.position.lerpVectors(t.prevPosition, t.position, alpha);
      const grow = Math.min(1, t.age / 0.4);
      const s = Math.max(0, t.strength) * grow;
      v.group.scale.set(0.4 + 0.6 * grow, grow, 0.4 + 0.6 * grow);
      for (const m of v.mats) {
        m.uniforms.uTime.value = time;
        m.uniforms.uOpacity.value = s;
      }
      if (this.vfx && s > 0.05) {
        const p = v.group.position;
        const n = Math.round(dt * 90 * s + Math.random());
        for (let i = 0; i < n; i++) {
          const h = Math.random() * H * 0.9;
          const r = 0.35 + (T.radius * 1.4 - 0.35) * Math.pow(h / H, 1.7) + Math.random() * 0.3;
          const a = Math.random() * Math.PI * 2;
          const tang = 6 + h * 1.2;
          this.vfx.dust.emit(p.x + Math.cos(a) * r, p.y + h, p.z + Math.sin(a) * r, -Math.sin(a) * tang, 2.5 + Math.random() * 2, Math.cos(a) * tang, {
            life: 0.6 + Math.random() * 0.5, size0: 0.35, size1: 0.9, color0: DUST_0, color1: DUST_1, alpha: 0.4, drag: 1.2, lift: 1,
          });
        }
        const nb = Math.round(dt * 40 * s + Math.random());
        for (let i = 0; i < nb; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.6 + Math.random() * 1.2;
          this.vfx.dust.emit(p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r, -Math.sin(a) * 7, 0.8, Math.cos(a) * 7, {
            life: 0.8 + Math.random() * 0.5, size0: 0.6, size1: 1.6, color0: DUST_0, color1: DUST_1, alpha: 0.35, drag: 1.5,
          });
        }
      }
    }
    for (const [id, v] of this.tornados) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      for (const m of v.mats) m.dispose();
      this.tornados.delete(id);
    }
  }

  private updateSpheres(dt: number, alpha: number, combatants: Combatant[], time: number): void {
    const S = GameConfig.air.sphere;
    for (const c of combatants) {
      const ctl = c.controller;
      let v = this.spheres.get(c.id);
      if (!(c.alive && ctl.sphereTimer > 0)) {
        if (v) v.group.visible = false;
        continue;
      }
      if (!v) {
        const group = new THREE.Group();
        const ms = windBallMaterial();
        const mc = windBallMaterial();
        mc.uniforms.uSpeed.value = -1.6;
        const core = new THREE.Mesh(this.ballGeo, mc);
        core.scale.setScalar(0.62);
        group.add(new THREE.Mesh(this.ballGeo, ms), core);
        this.scene.add(group);
        v = { group, mats: [ms, mc] };
        this.spheres.set(c.id, v);
      }
      v.group.visible = true;
      this.tmp.lerpVectors(ctl.prevPosition, ctl.position, alpha);
      const r = S.radius * (ctl.sphereBig ? S.bigScale : 1);
      this.tmp.y -= r * 0.9;
      v.group.position.copy(this.tmp);
      v.group.scale.setScalar(r);
      for (const m of v.mats) m.uniforms.uTime.value = time;
      if (this.vfx) {
        const n = Math.round(dt * (ctl.sphereBig ? 80 : 45) + Math.random());
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = r * (0.3 + Math.random() * 0.55);
          const sp = r * 6;
          this.vfx.wind.emit(this.tmp.x + Math.cos(a) * rr, this.tmp.y + (Math.random() - 0.5) * 1.4 * r, this.tmp.z + Math.sin(a) * rr, -Math.sin(a) * sp + ctl.velocity.x, 0, Math.cos(a) * sp + ctl.velocity.z, {
            life: 0.25 + Math.random() * 0.2, size0: r * 0.35, size1: r * 0.6, color0: WIND_0, color1: WIND_1, alpha: 0.22, drag: 2,
          });
        }
      }
    }
  }
}
