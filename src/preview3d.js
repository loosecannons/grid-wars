import * as THREE from 'three';
import { buildUnitMesh, buildCore } from './models.js';

// Small standalone viewport in the unit card: a high-res, slowly rotating
// model of the selected unit, with battle damage reflected on it.
export class UnitPreview {
  constructor(container, w = 218, h = 148) {
    this.w = w;
    this.h = h;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.w, this.h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, this.w / this.h, 0.1, 50);
    this.scene.add(new THREE.AmbientLight(0x90a8c8, 1.5));
    const dir = new THREE.DirectionalLight(0xbdd8ff, 1.6);
    dir.position.set(2.5, 3.5, 2);
    this.scene.add(dir);

    // red flash + jolt when the displayed unit takes a hit
    this.hitLight = new THREE.PointLight(0xff5533, 0, 12);
    this.hitLight.position.set(1.5, 2, 2);
    this.scene.add(this.hitLight);
    this._hitT = 0;

    this.pivot = null;
    this.active = false;
  }

  // faction: { color, isAI } — AI cores render as the MCP drum
  show(unit, faction) {
    this.clear();
    const model = unit.type === 'core'
      ? buildCore(faction.color, !!faction.isAI)
      : buildUnitMesh(unit.type, faction.color);

    // battle damage: hide the smallest detail parts first, knock the next
    // few askew, dim everything, and (in update) flicker the glow
    const frac = Math.max(0, unit.hp / unit.maxHp);
    this.frac = frac;
    this._glowMeshes = [];
    this._flickerT = 0;
    this._flickered = null;
    if (frac < 1) {
      const parts = [];
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const s = new THREE.Vector3();
        o.geometry.boundingBox.getSize(s);
        parts.push({ o, v: s.x * s.y * s.z });
      });
      parts.sort((a, b) => a.v - b.v);
      const hideN = Math.floor((1 - frac) * parts.length * 0.45);
      for (let i = 0; i < hideN; i++) parts[i].o.visible = false;
      // the next tier of small parts hangs loose, knocked out of true
      const askewN = Math.floor((1 - frac) * parts.length * 0.3);
      for (let i = hideN; i < hideN + askewN && i < parts.length; i++) {
        const o = parts[i].o;
        o.rotation.x += (Math.random() - 0.5) * 0.7;
        o.rotation.z += (Math.random() - 0.5) * 0.7;
        o.position.y -= Math.random() * 0.05;
      }
      // materials are shared between meshes — dim each one exactly once,
      // or repeated multiplication crushes the glow to black
      const dim = 0.35 + 0.65 * frac;
      const mats = new Set();
      model.traverse((o) => {
        if (o.isMesh && o.material) mats.add(o.material);
      });
      for (const m of mats) {
        if (m.color) m.color.multiplyScalar(dim);
      }
    }
    model.traverse((o) => {
      if (o.isMesh && o.visible && o.material &&
          o.material.userData && o.material.userData.glow) {
        this._glowMeshes.push(o);
      }
    });

    // center the model on a rotating pivot and frame the camera
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    this.pivot = new THREE.Group();
    this.pivot.add(model);
    this.scene.add(this.pivot);

    const maxDim = Math.max(size.x, size.y, size.z);
    this.camera.position.set(maxDim * 1.0, maxDim * 0.85, maxDim * 1.55);
    this.camera.lookAt(0, size.y * 0.45, 0);

    // reflect the unit's turret aim on the model (tanks only)
    this.turret = (model.userData && model.userData.turret) || null;
    this._turretCur = this._turretTarget = unit.turretAngle || 0;
    if (this.turret) this.turret.rotation.y = this._turretCur;

    this.active = true;
  }

  // Aim the displayed model's turret (smoothly eased in update()).
  setTurret(angle) {
    this._turretTarget = angle || 0;
  }

  clear() {
    // drop any in-flight detonation so a fresh show() can't render disposed
    // parts or fire a stale "card done" callback for a unit we're no longer on
    this.exploding = false;
    this._explodeParts = null;
    this._explodeMats = null;
    this._explodeDone = null;
    if (this.pivot) {
      this.pivot.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material) o.material.dispose();
        }
      });
      this.scene.remove(this.pivot);
      this.pivot = null;
    }
    this.turret = null;
    this.active = false;
    this.renderer.clear();
  }

  hide() {
    this.clear();
  }

  // Called when the displayed unit takes damage — visible hit reaction.
  hit() {
    this._hitT = 0.45;
  }

  // The displayed unit was destroyed — rather than blink the card out, blow the
  // model apart: every part flies off on its own arc, tumbling and fading, with
  // a hot flash. `onDone` fires once the blast finishes so the card can drop.
  explode(onDone) {
    if (!this.active || !this.pivot) { if (onDone) onDone(); return; }
    const parts = [];
    const mats = new Set();
    const wp = new THREE.Vector3(), pp = new THREE.Vector3();
    this.pivot.updateMatrixWorld(true);
    this.pivot.getWorldPosition(pp);
    this.pivot.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.material) {
        o.material.transparent = true;
        o.material.depthWrite = false;
        mats.add(o.material);
      }
      // blast outward from the model centre, biased upward
      o.getWorldPosition(wp);
      const dir = wp.sub(pp); dir.y = Math.abs(dir.y) + 0.25;
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 1, Math.random() - 0.5);
      dir.normalize();
      const sp = 1.3 + Math.random() * 1.9;
      parts.push({
        o,
        vel: new THREE.Vector3(
          dir.x * sp + (Math.random() - 0.5) * 0.7,
          dir.y * sp * 0.6 + 1.1 + Math.random() * 1.4,
          dir.z * sp + (Math.random() - 0.5) * 0.7),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14),
      });
    });
    this._explodeParts = parts;
    this._explodeMats = [...mats];
    this._explodeT = 0;
    this._explodeDur = 0.8;   // model flies apart and fades over this
    this._explodeHold = 1.4;  // then linger on the empty card before dropping it
    this._explodeDone = onDone || null;
    this.exploding = true;
    this._flashT = 0.16;
    this.hitLight.color.set(0xffd0a0);
  }

  _updateExplosion(dt) {
    dt = Math.min(dt, 0.05); // keep the blast steady through a frame hitch
    this._explodeT += dt;
    const blasting = this._explodeT < this._explodeDur;
    if (blasting) {
      const G = 6.5;
      for (const p of this._explodeParts) {
        p.vel.y -= G * dt;
        p.o.position.x += p.vel.x * dt;
        p.o.position.y += p.vel.y * dt;
        p.o.position.z += p.vel.z * dt;
        p.o.rotation.x += p.spin.x * dt;
        p.o.rotation.y += p.spin.y * dt;
        p.o.rotation.z += p.spin.z * dt;
      }
      const k = Math.min(1, this._explodeT / this._explodeDur);
      const op = 1 - k * k; // ease-out fade to nothing
      for (const m of this._explodeMats) m.opacity = op;
      this.pivot.rotation.y += dt * 0.5;
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      this.hitLight.intensity = 60 * Math.max(0, this._flashT / 0.16);
    } else {
      this.hitLight.intensity = 0;
    }
    this.renderer.render(this.scene, this.camera);
    // after the model has fully derezzed, hold the (now-empty) card a beat so
    // the "DEREZZED" result reads, then drop it
    if (this._explodeT >= this._explodeDur + this._explodeHold) {
      this.hitLight.color.set(0xff5533); // restore the hit-flash colour
      const cb = this._explodeDone;
      this.clear();                       // resets exploding state + disposes
      if (cb) cb();
    }
  }

  update(dt) {
    if (this.exploding) { this._updateExplosion(dt); return; }
    if (!this.active || !this.pivot) return;
    this.pivot.rotation.y += dt * 0.7; // slow full 360° spin
    if (this.turret) { // ease the turret toward its aim (relative to the hull)
      this._turretCur += (this._turretTarget - this._turretCur) * Math.min(1, dt * 8);
      this.turret.rotation.y = this._turretCur;
    }
    if (this._hitT > 0) {
      this._hitT -= dt;
      const k = Math.max(0, this._hitT / 0.45);
      this.pivot.position.x = (Math.random() - 0.5) * 0.1 * k;
      this.pivot.position.z = (Math.random() - 0.5) * 0.1 * k;
      this.hitLight.intensity = 30 * k;
    } else {
      this.pivot.position.x = 0;
      this.pivot.position.z = 0;
      this.hitLight.intensity = 0;
    }
    // badly damaged units short out: circuitry glow stutters
    if (this.frac < 0.55 && this._glowMeshes.length) {
      this._flickerT -= dt;
      if (this._flickerT <= 0) {
        if (this._flickered) { this._flickered.visible = true; this._flickered = null; }
        if (Math.random() < 0.65) {
          this._flickered = this._glowMeshes[
            Math.floor(Math.random() * this._glowMeshes.length)];
          this._flickered.visible = false;
        }
        this._flickerT = 0.06 + Math.random() * 0.22;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
