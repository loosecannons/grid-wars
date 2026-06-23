import * as THREE from 'three';
import { HEX_SIZE } from './hex.js';

// ---------- shared material helpers ----------

function darkMat(tint = 0x10151c) {
  // lift the near-black bodies well up into a mid grey so the models read
  // clearly against the dark Grid. A strong self-glow keeps shadowed faces from
  // crushing to black, and low metalness avoids the dark look unlit metal gets —
  // still dark enough to set off the bright highlights.
  const c = new THREE.Color(tint).lerp(new THREE.Color(0x6b7488), 0.58);
  return new THREE.MeshStandardMaterial({
    color: c, roughness: 0.62, metalness: 0.2,
    emissive: c.clone().multiplyScalar(0.26),
  });
}

function glowMat(color) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.userData.glow = true;
  m.userData.baseColor = color;
  return m;
}

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function cyl(rTop, rBot, h, seg, mat) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
}

// Collect every glow material in a group so the game can dim "spent" units.
function finalize(group) {
  const glows = [];
  group.traverse((o) => {
    if (o.isMesh && o.material && o.material.userData && o.material.userData.glow) {
      glows.push(o.material);
    }
  });
  group.userData.glowMats = glows;
  return group;
}

// ---------- units (all built facing +Z) ----------

export function buildLightCycle(color) {
  const g = new THREE.Group();
  const body = darkMat(0x0c1118);
  const body2 = darkMat(0x131c26);
  const glow = glowMat(color);

  // Two big enclosed wheels — the classic '82 silhouette
  const wheels = [];
  for (const z of [0.52, -0.52]) {
    const wheel = cyl(0.3, 0.3, 0.2, 24, body);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.3, z);
    g.add(wheel);
    wheels.push(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 32), glow);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(0, 0.3, z);
    g.add(rim);
    const rimInner = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 8, 28), glow);
    rimInner.rotation.y = Math.PI / 2;
    rimInner.position.set(0, 0.3, z);
    g.add(rimInner);
    const hub = cyl(0.06, 0.06, 0.23, 12, glow);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(0, 0.3, z);
    g.add(hub);
    // wheel fairing
    const fairing = box(0.24, 0.2, 0.42, body2);
    fairing.position.set(0, 0.52, z);
    g.add(fairing);
  }
  g.userData.wheels = wheels;

  // Arched spine and bodywork
  const spine = box(0.2, 0.28, 1.0, body);
  spine.position.set(0, 0.5, 0);
  g.add(spine);
  const nose = box(0.2, 0.16, 0.26, body2);
  nose.position.set(0, 0.4, 0.78);
  g.add(nose);
  const tail = box(0.2, 0.18, 0.24, body2);
  tail.position.set(0, 0.42, -0.78);
  g.add(tail);
  // side skirts
  for (const x of [0.13, -0.13]) {
    const skirt = box(0.035, 0.2, 0.85, body2);
    skirt.position.set(x, 0.3, 0);
    g.add(skirt);
    const skirtGlow = box(0.04, 0.025, 0.85, glow);
    skirtGlow.position.set(x, 0.21, 0);
    g.add(skirtGlow);
  }

  // Engine block slung low between the wheels, twin exhausts at the rear
  const engine = box(0.17, 0.16, 0.34, body2);
  engine.position.set(0, 0.26, -0.12);
  g.add(engine);
  for (const x of [0.055, -0.055]) {
    const exhaust = box(0.045, 0.045, 0.04, glow);
    exhaust.position.set(x, 0.28, -0.9);
    g.add(exhaust);
  }
  // front fork intake slits
  for (const x of [0.07, -0.07]) {
    const slit = box(0.02, 0.12, 0.03, glow);
    slit.position.set(x, 0.52, 0.74);
    g.add(slit);
  }

  // Canopy with windshield wedge and frame rail
  const canopy = box(0.15, 0.13, 0.42, body2);
  canopy.position.set(0, 0.68, 0.04);
  g.add(canopy);
  const canopyRail = box(0.16, 0.02, 0.44, glow);
  canopyRail.position.set(0, 0.745, 0.04);
  g.add(canopyRail);
  const windshield = box(0.13, 0.09, 0.12, glow);
  windshield.position.set(0, 0.66, 0.3);
  g.add(windshield);

  // Circuitry
  const strip = box(0.21, 0.03, 1.02, glow);
  strip.position.set(0, 0.645, 0);
  g.add(strip);
  for (const x of [0.105, -0.105]) {
    const side = box(0.012, 0.16, 0.9, glow);
    side.position.set(x, 0.46, 0);
    g.add(side);
  }
  const head = box(0.09, 0.06, 0.04, glow);
  head.position.set(0, 0.36, 0.92);
  g.add(head);
  const taillight = box(0.12, 0.05, 0.03, glow);
  taillight.position.set(0, 0.4, -0.91);
  g.add(taillight);

  g.scale.setScalar(0.95);
  return finalize(g);
}

export function buildTank(color) {
  const g = new THREE.Group();
  const body = darkMat(0x0d1219);
  const body2 = darkMat(0x141d28);
  const glow = glowMat(color);

  // Massive side treads with sloped caps and triple light lines
  for (const x of [0.45, -0.45]) {
    const tread = box(0.28, 0.32, 1.3, body);
    tread.position.set(x, 0.2, 0);
    g.add(tread);
    for (const [z, rot] of [[0.72, -0.55], [-0.72, 0.55]]) {
      const cap = box(0.28, 0.3, 0.32, body2);
      cap.position.set(x, 0.18, z);
      cap.rotation.x = rot;
      g.add(cap);
    }
    for (const y of [0.3, 0.2, 0.1]) {
      const line = box(0.3, y === 0.2 ? 0.02 : 0.032, 1.32, glow);
      line.position.set(x, y, 0);
      g.add(line);
    }
    // tread wheels hinted by glow discs
    for (const z of [0.45, 0, -0.45]) {
      const disc = cyl(0.07, 0.07, 0.3, 10, glow);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(x, 0.16, z);
      g.add(disc);
    }
  }

  // Stacked angular hull, '82 style, with side skirts
  const hullLow = box(0.66, 0.2, 1.2, body);
  hullLow.position.set(0, 0.38, 0);
  g.add(hullLow);
  const hullMid = box(0.56, 0.16, 0.95, body2);
  hullMid.position.set(0, 0.54, -0.06);
  g.add(hullMid);
  const hullTop = box(0.46, 0.12, 0.66, body);
  hullTop.position.set(0, 0.67, -0.12);
  g.add(hullTop);
  const trim1 = box(0.6, 0.025, 1.0, glow);
  trim1.position.set(0, 0.475, -0.03);
  g.add(trim1);
  const trim2 = box(0.5, 0.02, 0.74, glow);
  trim2.position.set(0, 0.625, -0.1);
  g.add(trim2);
  // driver visor and front chevron lights
  const visor = box(0.22, 0.05, 0.03, glow);
  visor.position.set(0, 0.56, 0.42);
  g.add(visor);
  for (const x of [0.16, -0.16]) {
    const chev = box(0.1, 0.05, 0.04, glow);
    chev.position.set(x, 0.42, 0.61);
    chev.rotation.y = x > 0 ? -0.5 : 0.5;
    g.add(chev);
  }
  // rear engine vents
  for (const y of [0.36, 0.43, 0.5]) {
    const vent = box(0.3, 0.025, 0.03, glow);
    vent.position.set(0, y, -0.6);
    g.add(vent);
  }

  // Rotating turret assembly (limited traverse — see game logic)
  const turret = new THREE.Group();
  turret.position.set(0, 0.83, -0.14);
  g.add(turret);
  g.userData.turret = turret;

  const drum = cyl(0.28, 0.32, 0.2, 6, body2);
  turret.add(drum);
  const cupola = cyl(0.12, 0.14, 0.1, 6, body);
  cupola.position.set(0, 0.14, 0);
  turret.add(cupola);
  const turretRing = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.022, 8, 24), glow);
  turretRing.rotation.x = Math.PI / 2;
  turretRing.position.set(0, 0.08, 0);
  turret.add(turretRing);
  // cheek plates
  for (const x of [0.24, -0.24]) {
    const cheek = box(0.1, 0.14, 0.3, body);
    cheek.position.set(x, 0, 0.08);
    turret.add(cheek);
    const cheekGlow = box(0.11, 0.02, 0.3, glow);
    cheekGlow.position.set(x, 0.08, 0.08);
    turret.add(cheekGlow);
  }
  // long cannon: sleeve + support bracket + barrel + glowing muzzle
  const sleeve = cyl(0.08, 0.08, 0.4, 10, body2);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, 0.02, 0.36);
  turret.add(sleeve);
  const bracket = box(0.06, 0.1, 0.08, body);
  bracket.position.set(0, -0.06, 0.5);
  turret.add(bracket);
  const sleeveRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 8, 16), glow);
  sleeveRing.position.set(0, 0.02, 0.56);
  turret.add(sleeveRing);
  const barrel = cyl(0.045, 0.045, 0.75, 10, body);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, 0.92);
  turret.add(barrel);
  const muzzle = cyl(0.06, 0.06, 0.12, 10, glow);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.02, 1.32);
  turret.add(muzzle);
  g.userData.muzzleLocal = new THREE.Vector3(0, 0.02, 1.38); // in turret space

  // Antenna
  const antenna = cyl(0.012, 0.012, 0.45, 6, body2);
  antenna.position.set(-0.18, 1.1, -0.34);
  g.add(antenna);
  const tip = box(0.035, 0.035, 0.035, glow);
  tip.position.set(-0.18, 1.33, -0.34);
  g.add(tip);

  g.scale.setScalar(0.92);
  return finalize(g);
}

export function buildRecognizer(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); // bobs up and down while hovering
  g.add(inner);
  const body = darkMat(0x0c1016);
  const body2 = darkMat(0x131a24);
  const glow = glowMat(color);

  // Big top block with central notch and layered cap — the '82 profile
  const top = box(1.5, 0.46, 0.56, body);
  top.position.set(0, 1.2, 0);
  inner.add(top);
  const cap = box(1.24, 0.08, 0.5, body2);
  cap.position.set(0, 1.47, 0);
  inner.add(cap);
  const notch = box(0.52, 0.14, 0.6, body2);
  notch.position.set(0, 1.36, 0);
  inner.add(notch);
  const browGlow = box(1.52, 0.04, 0.58, glow);
  browGlow.position.set(0, 1.0, 0);
  inner.add(browGlow);
  for (const x of [0.55, -0.55]) {
    const vent = box(0.22, 0.05, 0.58, glow);
    vent.position.set(x, 1.3, 0);
    inner.add(vent);
  }
  // corner marker lights
  for (const x of [0.72, -0.72]) {
    for (const z of [0.26, -0.26]) {
      const marker = box(0.05, 0.05, 0.05, glow);
      marker.position.set(x, 1.4, z);
      inner.add(marker);
    }
  }

  // Shoulders and segmented, tapering legs
  for (const x of [0.62, -0.62]) {
    const shoulder = box(0.36, 0.26, 0.6, body2);
    shoulder.position.set(x, 0.86, 0);
    inner.add(shoulder);
    // outboard sensor pods
    const pod = box(0.14, 0.26, 0.28, body);
    pod.position.set(x * 1.32, 0.88, 0);
    inner.add(pod);
    const podLight = box(0.05, 0.05, 0.3, glow);
    podLight.position.set(x * 1.36, 0.8, 0);
    inner.add(podLight);
    const upperLeg = box(0.3, 0.42, 0.52, body);
    upperLeg.position.set(x * 0.95, 0.55, 0);
    inner.add(upperLeg);
    const lowerLeg = box(0.24, 0.4, 0.46, body2);
    lowerLeg.position.set(x * 0.9, 0.2, 0);
    inner.add(lowerLeg);
    const foot = box(0.4, 0.14, 0.62, body);
    foot.position.set(x * 0.88, 0.0, 0);
    inner.add(foot);
    const footGlow = box(0.42, 0.025, 0.64, glow);
    footGlow.position.set(x * 0.88, 0.08, 0);
    inner.add(footGlow);
    // inner leg circuitry
    const legGlow = box(0.035, 0.85, 0.48, glow);
    legGlow.position.set(x * 0.66, 0.5, 0);
    inner.add(legGlow);
  }

  // Floating head in the central gap, framed, with a dark visor band
  const headFrame = box(0.34, 0.38, 0.2, body2);
  headFrame.position.set(0, 0.62, -0.1);
  inner.add(headFrame);
  const head = box(0.24, 0.28, 0.24, glow);
  head.position.set(0, 0.62, 0.02);
  inner.add(head);
  const visorBand = box(0.26, 0.07, 0.03, body);
  visorBand.position.set(0, 0.65, 0.14);
  inner.add(visorBand);
  g.userData.head = head;
  g.userData.inner = inner;
  g.userData.headLocal = new THREE.Vector3(0, 0.62, 0.18);

  g.scale.setScalar(1.05);
  return finalize(g);
}

export function buildCore(color, isMCP) {
  const g = new THREE.Group();
  const body = darkMat(0x0b0f15);
  const glow = glowMat(color);

  if (isMCP) {
    // The MCP — a great slowly rotating cylinder banded with light
    const base = cyl(0.85, 0.95, 0.25, 24, body);
    base.position.y = 0.12;
    g.add(base);
    const drum = cyl(0.55, 0.62, 1.5, 24, body);
    drum.position.y = 1.0;
    g.add(drum);
    g.userData.spin = drum;
    for (const y of [0.5, 0.95, 1.4]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 8, 32), glow);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      g.add(band);
    }
    const crown = cyl(0.2, 0.5, 0.35, 24, glow);
    crown.position.y = 1.9;
    g.add(crown);
  } else {
    // I/O Tower — beacon column with a beam to the heavens
    const base = cyl(0.8, 0.95, 0.3, 8, body);
    base.position.y = 0.15;
    g.add(base);
    const column = cyl(0.3, 0.45, 1.3, 8, body);
    column.position.y = 0.95;
    g.add(column);
    for (const y of [0.45, 1.0, 1.5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.42 - y * 0.08, 0.03, 8, 24), glow);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      g.add(band);
    }
    const beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, depthWrite: false,
    });
    beamMat.userData.glow = true;
    beamMat.userData.baseColor = color;
    const beam = cyl(0.1, 0.16, 7, 10, beamMat);
    beam.position.y = 4.8;
    g.add(beam);
    g.userData.beam = beam;
  }
  return finalize(g);
}

// Light Jet — sleek TRON: Legacy-style flyer: delta wings, glowing cockpit
// spine and twin tail fins, engine glow at the rear. Built facing +Z.
export function buildLightJet(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); // bobs while hovering
  g.add(inner);
  const body = darkMat(0x0c1016);
  const body2 = darkMat(0x131a24);
  const glow = glowMat(color);
  const Y = 0.28; // centre height so it floats above ground units

  // tapered fuselage + nose
  const fuse = box(0.3, 0.22, 1.35, body);
  fuse.position.set(0, Y, 0.05);
  inner.add(fuse);
  const nose = cyl(0.015, 0.16, 0.5, 6, body2);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, Y, 0.92);
  inner.add(nose);
  // glowing canopy + dorsal spine
  const canopy = box(0.15, 0.12, 0.42, glow);
  canopy.position.set(0, Y + 0.1, 0.34);
  inner.add(canopy);
  const spine = box(0.045, 0.045, 1.1, glow);
  spine.position.set(0, Y + 0.14, 0.0);
  inner.add(spine);

  // swept delta wings with lit leading edges + wingtip lights
  for (const s of [1, -1]) {
    const wing = box(0.86, 0.045, 0.66, body);
    wing.position.set(s * 0.52, Y, -0.12);
    wing.rotation.y = s * -0.34; // sweep back
    inner.add(wing);
    const edge = box(0.86, 0.03, 0.05, glow);
    edge.position.set(s * 0.52, Y + 0.02, 0.16);
    edge.rotation.y = s * -0.34;
    inner.add(edge);
    const tip = box(0.07, 0.06, 0.18, glow);
    tip.position.set(s * 0.93, Y, -0.24);
    inner.add(tip);
  }

  // twin canted tail fins
  for (const s of [1, -1]) {
    const fin = box(0.04, 0.3, 0.3, body2);
    fin.position.set(s * 0.15, Y + 0.16, -0.54);
    fin.rotation.z = s * -0.35;
    inner.add(fin);
    const finGlow = box(0.05, 0.26, 0.04, glow);
    finGlow.position.set(s * 0.2, Y + 0.16, -0.64);
    finGlow.rotation.z = s * -0.35;
    inner.add(finGlow);
  }

  // engine exhaust glow
  const exhaust = cyl(0.12, 0.09, 0.16, 10, glow);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, Y, -0.68);
  inner.add(exhaust);

  g.userData.inner = inner;
  g.userData.headLocal = new THREE.Vector3(0, Y, 1.05); // laser fires from the nose
  g.scale.setScalar(0.82);
  return finalize(g);
}

export function buildUnitMesh(type, color) {
  switch (type) {
    case 'cycle': return buildLightCycle(color);
    case 'tank': return buildTank(color);
    case 'reco': return buildRecognizer(color);
    case 'jet': return buildLightJet(color);
    default: throw new Error('unknown unit type ' + type);
  }
}

// ---------- terrain ----------

const tileGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.965, HEX_SIZE * 0.965, 0.14, 6);
const tileEdges = new THREE.EdgesGeometry(tileGeo, 30);

// ---------- instanced shader floor ----------
// The flat (normal) cells — the overwhelming majority — render as ONE instanced
// mesh instead of a mesh + line pair each. A small shader draws the dark fill
// and the glowing hex border procedurally, so there are no per-cell line
// segments either. This collapses thousands of draw calls into one.
const TILE_R = HEX_SIZE * 0.965;            // matches the per-cell tiles
const TILE_APOTHEM = TILE_R * 0.8660254;    // centre-to-edge distance

// a single flat hexagon (top face only). Vertices use CylinderGeometry's
// (sin, cos) convention so the hex orientation matches the per-cell tiles
// (a vertex pointing +z / north) and the grid tiles seamlessly.
const hexFlatGeo = (() => {
  const pos = [0, 0, 0], idx = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pos.push(Math.sin(a) * TILE_R, 0, Math.cos(a) * TILE_R);
  }
  for (let i = 0; i < 6; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
})();

function makeTileFieldMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    extensions: { derivatives: true }, // fwidth() — keeps the border a constant screen width
    uniforms: {
      uFill: { value: new THREE.Color(0x060b11) },
      uEdge: { value: new THREE.Color(0x176f86) }, // cyan border (brighter for bloom)
    },
    vertexShader: `
      attribute vec3 aTint;
      varying vec2 vLocal;
      varying vec3 vTint;
      void main() {
        vLocal = position.xz;   // local hex coordinate on the flat face
        vTint = aTint;
        #ifdef USE_INSTANCING
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      uniform vec3 uFill; uniform vec3 uEdge;
      varying vec2 vLocal; varying vec3 vTint;
      // signed distance to the hexagon border (<0 inside). Edge normals at
      // 0°,60°,… match the (sin,cos) vertex layout above.
      float hexSDF(vec2 p) {
        float d = -1e9;
        for (int i = 0; i < 6; i++) {
          float a = radians(60.0 * float(i));
          d = max(d, dot(p, vec2(cos(a), sin(a))) - ${TILE_APOTHEM.toFixed(4)});
        }
        return d;
      }
      void main() {
        float d = hexSDF(vLocal);
        // a single flat-colour border line of CONSTANT SCREEN WIDTH — fwidth(d)
        // is how fast the distance changes per pixel, so the line stays a clean
        // ~1.5px regardless of zoom (a fixed world-width line breaks up sub-pixel
        // when zoomed out, which is what looked dirty)
        float aa = fwidth(d);
        float edge = 1.0 - smoothstep(aa * 0.75, aa * 2.0, abs(d));
        vec3 col = mix(uFill, uEdge, edge) + vTint;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// Build one InstancedMesh for a set of flat cells. positions: [{x,z,key}].
// Returns the mesh plus key↔index lookups and a writable aTint attribute.
export function buildTileField(positions) {
  const n = positions.length;
  const mat = makeTileFieldMaterial();
  const mesh = new THREE.InstancedMesh(hexFlatGeo, mat, Math.max(1, n));
  const tint = new Float32Array(Math.max(1, n) * 3); // additive per-tile boost (hover)
  mesh.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const M = new THREE.Matrix4();
  const keys = [], keyToIndex = new Map();
  positions.forEach((p, i) => {
    M.makeTranslation(p.x, -0.03, p.z);
    mesh.setMatrixAt(i, M);
    keys[i] = p.key; keyToIndex.set(p.key, i);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = n;
  mesh.frustumCulled = false; // it spans the whole Grid
  mesh.userData.keys = keys;
  mesh.userData.keyToIndex = keyToIndex;
  mesh.userData.tintAttr = mesh.geometry.getAttribute('aTint');
  return mesh;
}

export function buildTile() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x060b11, roughness: 0.8, metalness: 0.2,
    emissive: 0x06222b, emissiveIntensity: 0.35,
  });
  const tile = new THREE.Mesh(tileGeo, mat);
  tile.position.y = -0.07;
  const lines = new THREE.LineSegments(
    tileEdges,
    new THREE.LineBasicMaterial({ color: 0x0e5566, transparent: true, opacity: 0.9 })
  );
  lines.position.y = -0.07;
  const g = new THREE.Group();
  g.add(tile, lines);
  g.userData.tileMesh = tile;
  return g;
}

const hlGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.88, HEX_SIZE * 0.88, 0.03, 6);

export function buildHighlight() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2bd9ff, transparent: true, opacity: 0.28, depthWrite: false,
  });
  const m = new THREE.Mesh(hlGeo, mat);
  m.position.y = 0.04;
  m.visible = false;
  return m;
}

// Level-of-detail stand-in: a single bright faction-coloured "blip" swapped in
// for a unit's full ~40-mesh model when the camera is far enough that the
// detail would be sub-pixel. One draw call per unit instead of dozens — the
// big win on large maps zoomed out. The geometry is built PER UNIT (never
// shared) so game.js's on-death dispose can free it without touching others.
export function buildUnitProxy(type, color) {
  const geo = new THREE.OctahedronGeometry(type === 'core' ? 0.5 : 0.34);
  geo.scale(1, type === 'core' ? 1.6 : 1.35, 1); // a slightly tall diamond reads as a unit
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  m.position.y = type === 'core' ? 0.6 : 0.34;
  return m;
}

// Healing pad — units standing here repair at the start of their turn.
export function buildHealTile() {
  const g = buildTile();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6fffcf, transparent: true, opacity: 0.7, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HEX_SIZE * 0.5, 0.035, 8, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  for (const rot of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.09), mat);
    bar.rotation.y = rot;
    bar.position.y = 0.03;
    g.add(bar);
  }
  g.userData.healMat = mat; // pulsed by the game loop

  // a slow stream of green motes rising off the pad
  const COUNT = 16;
  const HEIGHT = 2.0;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * HEX_SIZE * 1.1;
    positions[i * 3 + 1] = Math.random() * HEIGHT;
    positions[i * 3 + 2] = (Math.random() - 0.5) * HEX_SIZE * 1.1;
    speeds[i] = 0.18 + Math.random() * 0.22;
  }
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stream = new THREE.Points(streamGeo, new THREE.PointsMaterial({
    color: 0x7dffc8, size: 0.085, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  stream.position.y = 0.04;
  g.add(stream);
  g.userData.healStream = { geo: streamGeo, speeds, count: COUNT, height: HEIGHT };
  return g;
}

// Raised plateau — only recognizers can cross (movement cost 2).
const highGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.965, HEX_SIZE * 0.985, 0.94, 6);
const highEdges = new THREE.EdgesGeometry(highGeo, 30);

export function buildHighTile() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x081019, roughness: 0.7, metalness: 0.3,
    emissive: 0x0a3140, emissiveIntensity: 0.35,
  });
  const block = new THREE.Mesh(highGeo, mat);
  block.position.y = 0.33; // top face at y = 0.8
  g.add(block);
  const lines = new THREE.LineSegments(
    highEdges,
    new THREE.LineBasicMaterial({ color: 0x14606f, transparent: true, opacity: 0.85 })
  );
  lines.position.y = 0.33;
  g.add(lines);
  g.userData.tileMesh = block;
  return g;
}

// Pit in the Grid floor — a gap revealing the deep grid below.
// Only recognizers can fly across (movement cost 2).
const shaftGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.94, HEX_SIZE * 0.94, 0.55, 6, 1, true);

export function buildHoleTile() {
  const g = new THREE.Group();
  // bright hazard rim so pits read clearly against the dark tiles
  const rim = new THREE.LineSegments(
    tileEdges,
    new THREE.LineBasicMaterial({ color: 0x1fb9dd, transparent: true, opacity: 0.95 })
  );
  rim.position.y = -0.07; // matches normal tile rim height
  g.add(rim);
  const rimRing = new THREE.Mesh(
    new THREE.TorusGeometry(HEX_SIZE * 0.8, 0.028, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x0fa5c5 })
  );
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.03;
  g.add(rimRing);
  const walls = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
    color: 0x020a10, side: THREE.BackSide,
  }));
  walls.position.y = -0.275;
  g.add(walls);
  // ember glow deep in the shaft
  const ember = new THREE.Mesh(
    new THREE.TorusGeometry(HEX_SIZE * 0.45, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0x7a1810, transparent: true, opacity: 0.6 })
  );
  ember.rotation.x = Math.PI / 2;
  ember.position.y = -0.42;
  g.add(ember);
  // translucent dark veil — depth shading and the raycast target for the cell
  const veil = new THREE.Mesh(
    new THREE.CylinderGeometry(HEX_SIZE * 0.94, HEX_SIZE * 0.94, 0.02, 6),
    new THREE.MeshBasicMaterial({ color: 0x000408, transparent: true, opacity: 0.7 })
  );
  veil.position.y = -0.3;
  g.add(veil);
  g.userData.tileMesh = veil;
  return g;
}

// Small glowing chevron on the ground showing which way a unit faces
// (facing matters: rear hits do +50% damage, frontal hits are deflected).
export function buildFacingWedge(color, y) {
  const geo = new THREE.ConeGeometry(0.13, 0.3, 3);
  geo.rotateX(Math.PI / 2); // point along +Z (the model's forward)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, y, 0.72);
  return m;
}

// ---------- health bars ----------

export function makeHealthBar(cssColor, yOffset) {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 14;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sprite.scale.set(0.95, 0.14, 1);
  sprite.position.y = yOffset;
  sprite.renderOrder = 10;

  function update(frac) {
    ctx.clearRect(0, 0, 96, 14);
    ctx.fillStyle = 'rgba(2,8,12,0.85)';
    ctx.fillRect(0, 0, 96, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 94, 12);
    ctx.fillStyle = cssColor;
    ctx.fillRect(3, 3, Math.max(0, 90 * frac), 8);
    tex.needsUpdate = true;
  }
  update(1);
  return { sprite, update };
}
