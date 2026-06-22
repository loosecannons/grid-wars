import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
// reused read-only white endpoint for per-frame colour lerps (never mutated)
const WHITE = new THREE.Color(0xffffff);

export class FX {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.tweens = [];
    this.systems = []; // particle systems with custom update
    this.remains = []; // settled derez wreckage, aged per game cycle
    this.speed = 1;    // global animation timescale (rises slightly per cycle)
    this.shakePower = 0;
    this._shakeOffset = new THREE.Vector3();
  }

  update(rawDt) {
    const dt = rawDt * this.speed;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k, dt);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        if (tw.done) tw.done();
        tw.res();
      }
    }
    for (let i = this.systems.length - 1; i >= 0; i--) {
      if (this.systems[i].update(dt) === false) {
        this.systems[i].dispose();
        this.systems.splice(i, 1);
      }
    }
    this.shakePower = Math.max(0, this.shakePower - dt * 1.6);
  }

  tween(dur, fn, done) {
    return new Promise((res) => this.tweens.push({ t: 0, dur, fn, done, res }));
  }

  wait(s) { return this.tween(s, () => {}); }

  shake(amount) {
    this.shakePower = Math.min(0.9, this.shakePower + amount);
  }

  getShakeOffset() {
    const p = this.shakePower * this.shakePower;
    this._shakeOffset.set(
      (Math.random() - 0.5) * p,
      (Math.random() - 0.5) * p * 0.6,
      (Math.random() - 0.5) * p
    );
    return this._shakeOffset;
  }

  // ---------- particles ----------

  burst({ pos, count = 50, color = 0xffffff, speed = 4, life = 0.9, gravity = 6, size = 0.16, spread = 1 }) {
    const positions = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * spread,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 2 * spread
      ).normalize();
      vels.push(dir.multiplyScalar(speed * (0.3 + Math.random() * 0.9)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    let age = 0;
    const scene = this.scene;
    this.systems.push({
      update: (dt) => {
        age += dt;
        if (age >= life) return false;
        const arr = geo.attributes.position.array;
        for (let i = 0; i < count; i++) {
          vels[i].y -= gravity * dt;
          arr[i * 3] += vels[i].x * dt;
          arr[i * 3 + 1] += vels[i].y * dt;
          arr[i * 3 + 2] += vels[i].z * dt;
          if (arr[i * 3 + 1] < 0.02) { arr[i * 3 + 1] = 0.02; vels[i].y *= -0.35; }
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = 1 - age / life;
        return true;
      },
      dispose: () => { scene.remove(points); geo.dispose(); mat.dispose(); },
    });
  }

  flash(pos, color, intensity = 10, dur = 0.4, distance = 14) {
    const light = new THREE.PointLight(color, intensity, distance, 1.6);
    light.position.copy(pos).y += 0.6;
    this.scene.add(light);
    this.tween(dur, (k) => { light.intensity = intensity * (1 - k); },
      () => this.scene.remove(light));
  }

  ring(pos, color, maxR = 2.6, dur = 0.55) {
    const geo = new THREE.RingGeometry(0.86, 1, 40);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).y = 0.06;
    this.scene.add(m);
    this.tween(dur, (k) => {
      m.scale.setScalar(0.2 + k * maxR);
      mat.opacity = 0.9 * (1 - k);
    }, () => { this.scene.remove(m); geo.dispose(); mat.dispose(); });
  }

  debris(pos, color, count = 9) {
    const geo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos).y += 0.3;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        2 + Math.random() * 4.5,
        (Math.random() - 0.5) * 5
      );
      const rot = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.tween(1.1, (k, dt) => {
        vel.y -= 11 * dt;
        m.position.addScaledVector(vel, dt);
        if (m.position.y < 0.06) { m.position.y = 0.06; vel.y *= -0.4; vel.x *= 0.7; vel.z *= 0.7; }
        m.rotation.x += rot.x * dt; m.rotation.y += rot.y * dt; m.rotation.z += rot.z * dt;
        mat.opacity = 1 - k;
      }, () => { this.scene.remove(m); mat.dispose(); });
      this.scene.add(m);
    }
  }

  // The full pyrotechnic package.
  // Elongated fragments streaking outward — the shrapnel of a hard hit.
  shrapnel(pos, color, count = 6, scale = 1) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.045, 0.045, 0.4 + Math.random() * 0.3);
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() < 0.45 ? 0xffffff : color,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos).y += 0.3;
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2, Math.random() * 0.9 + 0.25, (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar((5 + Math.random() * 6) * scale);
      const look = new THREE.Vector3();
      this.scene.add(m);
      this.tween(0.4 + Math.random() * 0.35, (k, dt) => {
        vel.y -= 11 * dt;
        m.position.addScaledVector(vel, dt);
        m.lookAt(look.copy(m.position).add(vel));
        m.scale.z = 1 + k * 1.8;
        mat.opacity = 1 - k * k;
      }, () => { this.scene.remove(m); geo.dispose(); mat.dispose(); });
    }
  }

  explosion(pos, color, scale = 1) {
    this.audio.explosion(scale);
    // per-blast variation so no two destructions look identical
    const s = scale * (0.85 + Math.random() * 0.4);
    this.flash(pos, 0xffffff, 14 * s, 0.18, 10 * s);
    this.flash(pos, color, 9 * s, 0.6, 12 * s);
    this.burst({ pos, count: Math.round(60 * s), color: 0xffffff, speed: 5.5 * s, life: 0.5, size: 0.2 });
    this.burst({ pos, count: Math.round(90 * s), color, speed: 4.5 * s, life: 1.0, size: 0.15 });
    // warm embers fountaining upward
    this.burst({ pos, count: Math.round(28 * s), color: 0xffb24a, speed: 3 * s, life: 1.2, gravity: 8, size: 0.12, spread: 0.55 });
    this.ring(pos, color, 2.4 * s, 0.5);
    this.ring(pos, 0xffffff, 1.5 * s, 0.35);
    if (Math.random() < 0.55) this.ring(pos, color, 3.3 * s, 0.75); // occasional outer shock
    this.debris(pos, color, Math.round(8 * s));
    this.shrapnel(pos, color, Math.round((4 + Math.random() * 5) * scale), s);
    this.shake(0.28 * scale);
    // brief fireball, randomly tinted toward the faction colour or hot orange
    const geo = new THREE.SphereGeometry(0.3, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ball = new THREE.Mesh(geo, mat);
    ball.position.copy(pos).y += 0.35;
    this.scene.add(ball);
    const c = new THREE.Color(Math.random() < 0.35 ? 0xff8a30 : color);
    this.tween(0.45, (k) => {
      ball.scale.setScalar(1 + k * 4 * s);
      mat.opacity = 1 - k;
      mat.color.lerpColors(WHITE, c, Math.min(1, k * 2));
    }, () => { this.scene.remove(ball); geo.dispose(); mat.dispose(); });
  }

  // TRON derez: the unit shatters into glowing voxels that scatter, settle,
  // and remain on the Grid as slowly fading wreckage for a few game cycles.
  // Voxel count and size scale with the unit's actual volume, so a core
  // shatters into far more debris than a light cycle.
  derez(group, color) {
    this.audio.derez();
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const volume = Math.max(0.05, size.x * size.y * size.z);
    const count = Math.round(Math.min(180, Math.max(40, volume * 55)));
    const cubeSize = Math.min(0.14, Math.max(0.07, 0.06 + volume * 0.012));
    const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    // each derez varies: some erupt in a column, some fan out flat
    const upBias = 0.5 + Math.random() * 1.6;
    const outBias = 1.9 - upBias * 0.45;
    const cubes = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const m = new THREE.Mesh(cubeGeo, mat);
      m.position.set(
        box.min.x + Math.random() * size.x,
        box.min.y + Math.random() * size.y,
        box.min.z + Math.random() * size.z
      );
      const spread = (1.6 + volume * 0.25) * outBias; // bigger units scatter wider
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        Math.random() * (1.8 + volume * 0.3) * upBias,
        (Math.random() - 0.5) * spread
      );
      this.scene.add(m);
      cubes.push({ m, mat, vel });
    }
    const center = box.getCenter(new THREE.Vector3());
    this.flash(center, color, 5 + volume * 1.5, 0.5, 7 + volume * 2);

    // a bright vertical derez column lances upward as it shatters
    const colH = 3 + volume * 0.8;
    const colGeo = new THREE.CylinderGeometry(0.07 + volume * 0.04, 0.16 + volume * 0.05, colH, 10, 1, true);
    const colMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.copy(center); col.position.y += colH * 0.4;
    this.scene.add(col);
    const cc = new THREE.Color(color);
    this.tween(0.5, (k) => {
      colMat.opacity = 0.85 * (1 - k);
      col.scale.x = col.scale.z = 1 - k * 0.6;
      col.scale.y = 1 + k * 0.8;
      colMat.color.lerpColors(WHITE, cc, k);
    }, () => { this.scene.remove(col); colGeo.dispose(); colMat.dispose(); });
    // warm embers drifting up out of the wreckage
    this.burst({
      pos: center.clone(), count: Math.round(18 + volume * 8),
      color: 0xffc060, speed: 1.8, life: 1.1, gravity: 5, size: 0.1, spread: 0.7,
    });

    const wreck = { cubes, cubeGeo, life: 1 };
    // glitch-scatter, then let the voxels rain down and settle as wreckage
    this.tween(1.7, (k, dt) => {
      const glitch = Math.min(1, k * 2); // staccato steps — very 1982
      const step = Math.floor(glitch * 7) / 7;
      for (const c of cubes) {
        c.m.position.addScaledVector(c.vel, dt);
        c.vel.y -= 4.5 * dt;
        if (c.m.position.y < 0.06) {
          c.m.position.y = 0.06;
          c.vel.set(c.vel.x * 0.4, 0, c.vel.z * 0.4);
        }
        c.mat.opacity = 1 - step * 0.5;
        c.m.scale.setScalar(1 - step * 0.4);
        c.m.visible = k > 0.5 || Math.random() > step * 0.4;
      }
    }, () => {
      for (const c of cubes) { c.m.visible = true; c.mat.opacity = 0.5; }
      this.remains.push(wreck);
    });
    return this.wait(0.9); // gameplay resumes while the debris settles
  }

  // Called once per game cycle; wreckage fades out over `turnsToVanish` cycles.
  ageRemains(turnsToVanish = 3) {
    for (let i = this.remains.length - 1; i >= 0; i--) {
      const w = this.remains[i];
      w.life -= 1 / turnsToVanish;
      if (w.life <= 0.01) {
        for (const c of w.cubes) { this.scene.remove(c.m); c.mat.dispose(); }
        w.cubeGeo.dispose();
        this.remains.splice(i, 1);
      } else {
        for (const c of w.cubes) c.mat.opacity = 0.5 * w.life;
      }
    }
  }

  // Rising, fading combat text (damage numbers, REAR STRIKE, etc.).
  floatText(pos, text, cssColor = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 64;
    const c = canvas.getContext('2d');
    c.font = '700 34px Orbitron, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = cssColor;
    c.shadowBlur = 14;
    c.fillStyle = cssColor;
    c.fillText(text, 160, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false,
    }));
    spr.scale.set(2.6, 0.52, 1);
    spr.position.copy(pos);
    spr.renderOrder = 20;
    this.scene.add(spr);
    const y0 = pos.y;
    this.tween(1.2, (k) => {
      spr.position.y = y0 + k * 1.0;
      spr.material.opacity = 1 - k * k;
    }, () => { this.scene.remove(spr); tex.dispose(); spr.material.dispose(); });
  }

  // An AI transmission that hovers above a core, then drifts up and fades.
  // Unlike the terse combat floatText labels this fits full sentences (canvas
  // width measured to the text) and lingers long enough to read (~2.6s).
  bark(pos, text, cssColor = '#ffffff') {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fontPx = 30;
    const padX = 26;
    const padY = 18;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `700 ${fontPx}px Orbitron, monospace`;
    const tw = Math.ceil(meas.measureText(text).width);
    const cw = tw + padX * 2;
    const ch = fontPx + padY * 2;
    const canvas = document.createElement('canvas');
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    c.font = `700 ${fontPx}px Orbitron, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = cssColor;
    c.shadowBlur = 16;
    c.fillStyle = cssColor;
    c.fillText(text, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, opacity: 0,
    }));
    const worldH = 0.7;
    spr.scale.set(worldH * (cw / ch), worldH, 1);
    spr.position.copy(pos);
    spr.renderOrder = 21;
    this.scene.add(spr);
    const y0 = pos.y;
    // fade in fast, hold, then rise + fade out
    this.tween(2.6, (k) => {
      spr.position.y = y0 + k * 0.9;
      spr.material.opacity =
        k < 0.1 ? k / 0.1 : (k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1);
    }, () => { this.scene.remove(spr); tex.dispose(); spr.material.dispose(); });
  }

  // A new unit beams onto the Grid: light column, rising sparks, ring.
  materialize(pos, color) {
    this.audio.materialize();
    this.ring(pos, color, 1.5, 0.6);
    this.flash(pos, color, 6, 0.5, 8);
    this.burst({
      pos: pos.clone().add(new THREE.Vector3(0, 0.15, 0)),
      count: 45, color, speed: 1.4, life: 0.8, gravity: -2.8, size: 0.11,
    });
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 14, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.position.y += 1.3;
    this.scene.add(m);
    this.tween(0.75, (k) => {
      mat.opacity = 0.45 * (1 - k);
      m.scale.x = m.scale.z = 1 - k * 0.55;
    }, () => { this.scene.remove(m); geo.dispose(); mat.dispose(); });
  }

  // ---------- weapon visuals ----------

  laserBeam(from, to, color, health = 1) {
    this.audio.laser(health);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());

    const outerGeo = new THREE.CylinderGeometry(0.07, 0.07, len, 8);
    const outerMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.copy(mid); outer.quaternion.copy(quat);

    const coreGeo = new THREE.CylinderGeometry(0.025, 0.025, len, 6);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.copy(mid); core.quaternion.copy(quat);

    this.scene.add(outer, core);
    this.burst({ pos: to, count: 30, color, speed: 3, life: 0.45, size: 0.1, gravity: 2 });
    this.flash(to, color, 6, 0.3, 8);

    return this.tween(0.45, (k) => {
      const flicker = 0.65 + 0.35 * Math.sin(k * 70);
      outerMat.opacity = (1 - k) * 0.8 * flicker;
      coreMat.opacity = (1 - k) * flicker;
    }, () => {
      this.scene.remove(outer, core);
      outerGeo.dispose(); coreGeo.dispose(); outerMat.dispose(); coreMat.dispose();
    });
  }

  // Rocket flies along an arc from `from` to `to`, then the caller detonates.
  rocket(from, to, color, health = 1) {
    this.audio.rocketLaunch(health);
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glowMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), bodyMat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), bodyMat);
    nose.position.y = 0.22;
    const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 8), glowMat);
    exhaust.rotation.x = Math.PI;
    exhaust.position.y = -0.3;
    g.add(body, nose, exhaust);
    this.scene.add(g);

    const peak = Math.max(from.y, to.y) + 1.6 + from.distanceTo(to) * 0.25;
    const ctrl = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    ctrl.y = peak;
    const curve = new THREE.QuadraticBezierCurve3(from.clone(), ctrl, to.clone());
    const tangent = new THREE.Vector3();
    const dur = 0.25 + from.distanceTo(to) * 0.07;
    let trailTimer = 0;

    return this.tween(dur, (k, dt) => {
      curve.getPoint(k, g.position);
      curve.getTangent(k, tangent);
      g.quaternion.setFromUnitVectors(UP, tangent.normalize());
      trailTimer += dt;
      if (trailTimer > 0.025) {
        trailTimer = 0;
        this.burst({ pos: g.position.clone(), count: 3, color, speed: 0.5, life: 0.4, size: 0.09, gravity: 0 });
      }
    }, () => {
      this.scene.remove(g);
      bodyMat.dispose(); glowMat.dispose();
    });
  }

  // A persistent light wall following a smooth curve (Catmull-Rom through the
  // cycle's path). Built as a vertical ribbon; reveal(k) extrudes it
  // progressively behind the moving cycle. Steady glow — no flashing.
  // tStart lets the ribbon cover only a trailing sub-range of the curve —
  // used when a phantom lead-in point shapes the start tangent.
  // `wave` > 0 bakes a gentle side-to-side ripple into the wall — used when a
  // damaged cycle lays a less-than-perfect light-wall.
  trailRibbon(curveOrPoints, color, samples = 40, tStart = 0, wave = 0, baseY = 0.02, top = 0.58) {
    const curve = Array.isArray(curveOrPoints)
      ? new THREE.CatmullRomCurve3(curveOrPoints, false, 'catmullrom', 0.5)
      : curveOrPoints;
    const N = Math.max(8, samples);
    const positions = new Float32Array((N + 1) * 2 * 3);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const ph = Math.random() * Math.PI * 2; // each wall ripples a little differently
    for (let i = 0; i <= N; i++) {
      const u = tStart + (i / N) * (1 - tStart);
      curve.getPoint(u, p);
      let ox = 0, oz = 0;
      if (wave > 0) {
        curve.getTangent(u, tan); // sway perpendicular to the wall's heading
        const len = Math.hypot(tan.x, tan.z) || 1;
        const s = Math.sin(i * 0.9 + ph) * wave;
        ox = (-tan.z / len) * s;
        oz = (tan.x / len) * s;
      }
      positions.set([p.x + ox, baseY, p.z + oz], i * 6);
      positions.set([p.x + ox, top, p.z + oz], i * 6 + 3);
    }
    const indices = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const wall = {
      mesh, mat, geo, dead: false,
      reveal: (k) => geo.setDrawRange(0, Math.floor(Math.max(0, Math.min(1, k)) * N) * 6),
      // a tank smashing through: collapse the ribbon's top edge near the breach
      cutAt: (pos, radius = 1.0) => {
        const arr = geo.attributes.position.array;
        for (let i = 0; i <= N; i++) {
          const x = arr[i * 6], z = arr[i * 6 + 2];
          if (Math.hypot(x - pos.x, z - pos.z) < radius) {
            arr[i * 6 + 4] = baseY + 0.02; // top vertex y -> floor level
          }
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
    return wall;
  }

  // A ribbon built from two explicit edge polylines (bottom & top) of 3D points
  // — unlike trailRibbon (a flat vertical strip), this lets a wall twist and
  // spiral in 3D, e.g. a jet's wingtip walls helixing through a barrel roll.
  ribbonEdges(bottom, top, color, baseOpacity = 0.55) {
    const N = Math.max(1, bottom.length - 1);
    const positions = new Float32Array((N + 1) * 2 * 3);
    for (let i = 0; i <= N; i++) {
      const b = bottom[i], t = top[i];
      positions.set([b.x, b.y, b.z], i * 6);
      positions.set([t.x, t.y, t.z], i * 6 + 3);
    }
    const indices = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: baseOpacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return {
      mesh, mat, geo, dead: false,
      reveal: (k) => geo.setDrawRange(0, Math.floor(Math.max(0, Math.min(1, k)) * N) * 6),
      // a tank smashing through: collapse the top edge onto the floor near it
      cutAt: (pos, radius = 1.0) => {
        const arr = geo.attributes.position.array;
        for (let i = 0; i <= N; i++) {
          const bx = arr[i * 6], bz = arr[i * 6 + 2];
          if (Math.hypot(bx - pos.x, bz - pos.z) < radius) {
            arr[i * 6 + 3] = arr[i * 6];          // top x -> bottom x
            arr[i * 6 + 4] = arr[i * 6 + 1] + 0.02; // top y -> just above bottom
            arr[i * 6 + 5] = arr[i * 6 + 2];      // top z -> bottom z
          }
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  }

  fadeWall(wall) {
    if (!wall || wall.dead) return;
    wall.dead = true;
    const startOp = wall.mat.opacity;
    this.tween(0.35, (k) => {
      wall.mat.opacity = startOp * (1 - k);
      wall.mesh.scale.y = 1 - k * 0.85;
    }, () => {
      this.scene.remove(wall.mesh);
      wall.geo.dispose();
      wall.mat.dispose();
    });
  }

  // A fading light-wall segment left behind by a moving light cycle.
  trailWall(a, b, color) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.01) return;
    const geo = new THREE.BoxGeometry(0.07, 0.55, len);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.position.y = 0.3;
    m.lookAt(b.x, 0.3, b.z);
    this.scene.add(m);
    this.tween(1.5, (k) => {
      mat.opacity = 0.75 * (1 - k);
      m.scale.y = 1 - k * 0.6;
    }, () => { this.scene.remove(m); geo.dispose(); mat.dispose(); });
  }

  // Quick impact slash used by the light cycle melee strike.
  slash(pos, color, health = 1) {
    this.audio.dash(health);
    this.burst({ pos, count: 35, color, speed: 4, life: 0.4, size: 0.13, gravity: 3 });
    this.burst({ pos, count: 15, color: 0xffffff, speed: 5, life: 0.25, size: 0.16, gravity: 1 });
    this.flash(pos, color, 7, 0.25, 7);
    this.shake(0.12);
  }
}
