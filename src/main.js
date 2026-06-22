import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { Game } from './game.js';
import { FX } from './effects.js';
import { AudioFX } from './audio.js';
import { UI } from './ui.js';
import { SIZES, COLOR_PALETTE } from './constants.js';
import { CAMPAIGNS } from './campaigns.js';
import { Net } from './net.js';
import { MapEditor } from './editor.js';
import { VERSION, REPO } from './version.js';

// ---------- renderer / scene ----------

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010409);
scene.fog = new THREE.FogExp2(0x010409, 0.014);

const camera = new THREE.PerspectiveCamera(
  48, window.innerWidth / window.innerHeight, 0.1, 300
);
camera.position.set(0, 15, 17);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 1);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = 1.32;
controls.minDistance = 6;
controls.maxDistance = 42;
controls.enablePan = true;
controls.update();

// lights — dim; the glow materials carry the look
scene.add(new THREE.AmbientLight(0x33485e, 1.2));
const dir = new THREE.DirectionalLight(0x6fa8ff, 0.9);
dir.position.set(6, 12, 4);
scene.add(dir);

// the endless grid plane, sunk well below the arena so that
// holes in the battlefield open onto the deep grid beneath
const grid = new THREE.GridHelper(240, 120, 0x0a2f3a, 0x062028);
grid.position.y = -0.66;
scene.add(grid);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshBasicMaterial({ color: 0x01070c })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.72;
scene.add(floor);

// distant horizon glow strips, like the game grid arenas of the film
for (let i = 0; i < 3; i++) {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(160 - i * 30, 0.25 + i * 0.2, 0.3),
    new THREE.MeshBasicMaterial({
      color: i % 2 ? 0xff9024 : 0x2bd9ff,
      transparent: true, opacity: 0.18,
    })
  );
  strip.position.set(0, 1 + i * 2.2, -60 - i * 12);
  scene.add(strip);
}

// ---------- post-processing (bloom = the whole TRON look) ----------

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85, 0.55, 0.25
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Post-process anti-aliasing on the FINAL image. MSAA can't be used here — it
// averages sample coverage, which dims thin ADDITIVE geometry (the glowing
// cycle/jet walls) into near-nothing. FXAA works on the composited pixels, so
// it smooths the jaggy wall edges while leaving their brightness intact.
const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);

// ---------- light / dark theme ----------
// Dark is the native neon look; light is a flat grey "workstation" skin (the
// CSS does the UI; here we recolour the 3D backdrop and ease off the bloom so
// the glow doesn't wash out on a pale background).
const themeBtn = document.getElementById('btn-theme');
function applyTheme(light) {
  document.body.classList.toggle('light', light);
  scene.background.set(light ? 0xc4c7cb : 0x010409);
  if (scene.fog) scene.fog.color.set(light ? 0xc8cbcf : 0x010409);
  floor.material.color.set(light ? 0x9a9ea3 : 0x01070c);
  bloom.strength = light ? 0.16 : 0.85;
  if (themeBtn) themeBtn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
  try { localStorage.setItem('gw-theme', light ? 'light' : 'dark'); } catch (e) { /* ignore */ }
}
applyTheme(localStorage.getItem('gw-theme') === 'light');
if (themeBtn) {
  themeBtn.addEventListener('click', () => applyTheme(!document.body.classList.contains('light')));
}

// ---------- CLASSIC MODE: chunky 16-bit isometric look ----------
// An orthographic isometric camera + a low-resolution (pixelated) render +
// a posterized, punchy palette + bloom off. Toggle persists in localStorage.
const isoCam = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 900);
const ISO_DIR = new THREE.Vector3(1, 0.92, 1).normalize(); // dimetric-ish view angle

// quantize the final image to a small palette, punch up saturation, AND stamp
// dark outlines via a luma Sobel — the sprite-style borders around units and
// the crisp definition between hex tiles come from this edge darkening. Run at
// the chunky low-res buffer, so the outlines land pixel-aligned and retro.
const PosterizeShader = {
  uniforms: {
    tDiffuse: { value: null }, levels: { value: 9.0 }, sat: { value: 1.42 },
    contrast: { value: 1.14 },
    texel: { value: new THREE.Vector2(1 / 300, 1 / 300) }, edge: { value: 0.7 },
  },
  vertexShader:
    'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float levels; uniform float sat; uniform float contrast;
    uniform vec2 texel; uniform float edge; varying vec2 vUv;
    float luma(vec2 uv){ return dot(texture2D(tDiffuse, uv).rgb, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, sat);                          // richer saturation
      c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);   // contrast pop (deeper blacks, brighter neon)
      c = floor(c * levels + 0.5) / levels;              // gentle posterize — enough levels to stay clean
      // 3x3 Sobel on luminance -> edge magnitude
      float tl = luma(vUv + texel * vec2(-1.0,-1.0));
      float tm = luma(vUv + texel * vec2( 0.0,-1.0));
      float tr = luma(vUv + texel * vec2( 1.0,-1.0));
      float ml = luma(vUv + texel * vec2(-1.0, 0.0));
      float mr = luma(vUv + texel * vec2( 1.0, 0.0));
      float bl = luma(vUv + texel * vec2(-1.0, 1.0));
      float bm = luma(vUv + texel * vec2( 0.0, 1.0));
      float br = luma(vUv + texel * vec2( 1.0, 1.0));
      float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
      float gy = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
      float g = sqrt(gx * gx + gy * gy);
      float e = smoothstep(0.10, 0.42, g) * edge;     // strong silhouettes only
      c *= (1.0 - e);                                  // darken toward a black border
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
const posterizePass = new ShaderPass(PosterizeShader);
posterizePass.enabled = false;
composer.addPass(posterizePass);

let activeCamera = camera;
let classic = localStorage.getItem('gw-classic') === '1';
const PIX_H = 500; // classic render-buffer height — higher-res retro (crisp 2x integer upscale)

let isoYaw = 0;    // classic-mode rotation of the board around the vertical axis
let isoYawTo = 0;  // eased target for 90° step rotations (Q / E)

// Point the orthographic camera at the grid centre from the fixed dimetric
// elevation, spun around Y by isoYaw so the player can rotate the board.
function positionIsoCam(R) {
  const radius = R != null ? R : (game.config ? game.config.radius : 12);
  const d = (radius * 1.8 + 2) * 3;
  const cos = Math.cos(isoYaw), sin = Math.sin(isoYaw);
  const rx = ISO_DIR.x * cos - ISO_DIR.z * sin; // rotate the horizontal heading
  const rz = ISO_DIR.x * sin + ISO_DIR.z * cos;
  isoCam.position.set(rx * d, ISO_DIR.y * d, rz * d);
  isoCam.lookAt(0, 0, 0);
}

function fitIsoCamera(R, reposition = true) {
  const span = (R * 1.8 + 2) * 1.08;
  const aspect = window.innerWidth / window.innerHeight;
  isoCam.left = -span * aspect; isoCam.right = span * aspect;
  isoCam.top = span; isoCam.bottom = -span;
  const d = (R * 1.8 + 2) * 3;
  isoCam.near = 1; isoCam.far = d * 2 + 80;
  if (reposition) positionIsoCam(R); // only the initial framing; orbit owns it after
  isoCam.updateProjectionMatrix();
}

// Hand the orthographic 16-bit view to OrbitControls so it has the same free
// orbit / zoom / pan as the modern view (no fixed-angle / 90°-snap lock).
function enterClassicCamera(R) {
  controls.object = isoCam;
  controls.target.set(0, 0, 0);
  controls.minZoom = 0.5; controls.maxZoom = 8; // ortho zoom range
  fitIsoCamera(R, true);                          // dimetric starting frame
  controls.enabled = true;
  controls.update();
}

function resizeRender() {
  const W = window.innerWidth, H = window.innerHeight;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  const canvas = renderer.domElement;
  if (classic) {
    // Full-resolution STYLISED retro: posterised palette + dark outlines + the
    // iso camera, but no low-res downscale. The earlier pixel buffer stair-
    // stepped thin curved geometry (the cycle-wall "zaggies"); rendering at full
    // res keeps the bezier walls smooth while the colour/outline treatment still
    // gives the 16-bit feel.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    composer.setSize(W, H);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    posterizePass.uniforms.texel.value.set(1.6 / db.x, 1.6 / db.y); // ~1.5px outline
    canvas.style.width = ''; canvas.style.height = '';
    canvas.style.imageRendering = '';
    fitIsoCamera(game.config ? game.config.radius : 12, false); // keep the orbit on resize
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    composer.setSize(W, H);
    canvas.style.imageRendering = '';
  }
  // FXAA samples in 1/pixel units of the actual drawing buffer
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  fxaaPass.material.uniforms.resolution.value.set(1 / db.x, 1 / db.y);
}

// 16-bit mode paints the base hex tiles light grey (a flat "board" colour that
// reads better posterized); modern keeps the deep near-black fill. Applied to
// whichever tile field currently exists, and re-applied when a map rebuilds.
function setTileBaseColor() {
  const u = game && game.tileField && game.tileField.material
    && game.tileField.material.uniforms;
  if (u && u.uFill) u.uFill.value.set(classic ? 0x1a3a5c : 0x060b11);
}

// Apply the persisted render mode to the camera, passes and resolution.
function applyRenderMode() {
  classic = localStorage.getItem('gw-classic') === '1';
  activeCamera = classic ? isoCam : camera;
  controls.object = activeCamera; // OrbitControls drives whichever camera is live
  renderPass.camera = activeCamera;
  bloom.enabled = !classic;
  posterizePass.enabled = classic;
  fxaaPass.enabled = !classic; // classic keeps its crisp posterised/outlined look
  resizeRender();
  setTileBaseColor();
  // toggling the visual mode live (a game already running) — re-establish the
  // iso orbit camera (startGame handles a fresh game once the map exists).
  // Switching back to modern keeps the controls' existing enabled state.
  if (classic && game.config) enterClassicCamera(game.config.radius);
  window.__camera = activeCamera; // debug handle tracks the live camera
}

// ---------- game wiring ----------

const ui = new UI();
const audio = new AudioFX();
const fx = new FX(scene, audio);
const game = new Game(scene, fx, audio, ui);

// The turn driver runs as un-awaited fire-and-forget promises; a throw deep in
// it (AI hitting a null unit, a desynced replay) would otherwise silently
// freeze the game mid-turn with no recovery. Surface it as a fault banner.
window.addEventListener('unhandledrejection', (e) => {
  console.error('GRID FAULT (unhandled rejection):', e.reason);
  if (game) { game.over = true; game.busy = false; }
  try { ui.showBanner('GRID FAULT — RELOAD TO CONTINUE', '#ff5544', 6000); } catch (_) { /* pre-boot */ }
});

applyRenderMode(); // set the persisted render mode now that `game` exists

ui.setEndTurnEnabled(false);

let flyingIn = false; // declared before startGame may run at module load

// ---------- ambient light effects on the Grid ----------

const ambient = { pylonMats: [], pylons: [], sparks: null, sparkVel: [], extent: 20 };

function setupAmbient(R) {
  const hexW = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2), z: 1.5 * r });
  ambient.extent = R * 1.9;
  ambient.pylons.length = 0;

  // beacon pylons just beyond the six corners of the arena
  for (const [q, r] of [[R, 0], [0, R], [-R, R], [-R, 0], [0, -R], [R, -R]]) {
    const { x, z } = hexW(q * 1.18, r * 1.18);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1fc8e8, transparent: true, opacity: 0.5,
    });
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 4.5, 6), mat);
    pylon.position.set(x, 2.0, z);
    scene.add(pylon);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat);
    cap.position.set(x, 4.4, z);
    scene.add(cap);
    ambient.pylonMats.push(mat);
    ambient.pylons.push(new THREE.Vector3(x, 4.4, z)); // cap height, for arcs
  }

  // tesla-coil arcs that crackle between neighbouring pylons now and then
  const teslaArc = () => {
    if (!game.config || ambient.pylons.length < 2) { setTimeout(teslaArc, 6000); return; }
    const i = Math.floor(Math.random() * ambient.pylons.length);
    const j = (i + 1) % ambient.pylons.length;            // arc to a neighbour
    const A = ambient.pylons[i], B = ambient.pylons[j];
    const N = 10;
    const arr = new Float32Array((N + 1) * 3);
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat2 = new THREE.LineBasicMaterial({
      color: 0xcdfaff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo2, mat2);
    line.frustumCulled = false;
    scene.add(line);
    const regen = () => {
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const jit = (k > 0 && k < N) ? 1 : 0; // anchor the two ends to the caps
        arr[k * 3] = A.x + (B.x - A.x) * u + (Math.random() - 0.5) * 1.3 * jit;
        arr[k * 3 + 1] = A.y + (B.y - A.y) * u + (Math.random() - 0.2) * 1.6 * jit;
        arr[k * 3 + 2] = A.z + (B.z - A.z) * u + (Math.random() - 0.5) * 1.3 * jit;
      }
      geo2.attributes.position.needsUpdate = true;
    };
    regen();
    audio.zap();
    // bright pops at both pylon caps make the discharge unmistakable
    fx.flash(A.clone(), 0x9df0ff, 9, 0.28, 16);
    fx.flash(B.clone(), 0x9df0ff, 9, 0.28, 16);
    let lastFlick = 0;
    fx.tween(0.24, (k) => {
      if (k - lastFlick > 0.05) { regen(); lastFlick = k; } // crackling flicker
      mat2.opacity = 0.95 * (1 - k) * (0.55 + Math.random() * 0.45);
    }, () => { scene.remove(line); geo2.dispose(); mat2.dispose(); });
    setTimeout(teslaArc, 3500 + Math.random() * 6500);
  };
  setTimeout(teslaArc, 2800);

  // drifting data sparks rising slowly off the Grid floor
  const count = 140;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 2 * ambient.extent;
    positions[i * 3 + 1] = Math.random() * 3.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * ambient.extent;
    ambient.sparkVel.push(0.12 + Math.random() * 0.35);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ambient.sparks = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x3fd8f0, size: 0.07, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(ambient.sparks);

  // energy streaks racing across the deep grid every few seconds —
  // kept OUTSIDE the arena footprint so they don't shimmer through
  // the gaps between the battlefield tiles
  const streak = () => {
    if (!game.config) return;
    const horizontalAxis = Math.random() < 0.5;
    const off = (Math.random() < 0.5 ? -1 : 1)
      * ambient.extent * (0.98 + Math.random() * 0.45);
    const len = ambient.extent * 2.6;
    const geo2 = new THREE.BoxGeometry(
      horizontalAxis ? 1.8 : 0.05, 0.03, horizontalAxis ? 0.05 : 1.8);
    const mat2 = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? 0x2bd9ff : 0x9adfff,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(geo2, mat2);
    m.position.y = -0.6; // skimming the deep grid below the arena
    scene.add(m);
    const dir = Math.random() < 0.5 ? 1 : -1;
    fx.tween(1.1, (k) => {
      const d = (-len / 2 + k * len) * dir;
      if (horizontalAxis) m.position.set(d, -0.6, off);
      else m.position.set(off, -0.6, d);
      mat2.opacity = 0.8 * Math.sin(k * Math.PI);
    }, () => { scene.remove(m); geo2.dispose(); mat2.dispose(); });
    setTimeout(streak, 2500 + Math.random() * 5500);
  };
  setTimeout(streak, 2000);

  // energy pulses racing along the gaps BETWEEN the hex tiles: a random
  // walk on the honeycomb lattice (each corner offers a ±60° turn)
  const hexPulse = () => {
    if (!game.config) return;
    const cells = [...game.cells.values()];
    const cell = cells[Math.floor(Math.random() * cells.length)];
    const c = hexW(cell.q, cell.r);
    const corner = (k) => ({
      x: c.x + Math.sin(k * Math.PI / 3),
      z: c.z + Math.cos(k * Math.PI / 3),
    });
    const k0 = Math.floor(Math.random() * 6);
    let pos = corner(k0);
    const next = corner((k0 + 1) % 6);
    let ang = Math.atan2(next.x - pos.x, next.z - pos.z);
    const pts = [{ ...pos }];
    const steps = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < steps; i++) {
      pos = { x: pos.x + Math.sin(ang), z: pos.z + Math.cos(ang) };
      pts.push({ ...pos });
      if (Math.hypot(pos.x, pos.z) > ambient.extent) break;
      ang += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 3; // stay on the lattice
    }
    // sample the whole zigzag into a polyline and reveal a moving window —
    // the pulse can never cut corners or float off the lattice
    const Y = 0.015;
    const SAMPLES = 6;
    const positions = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let s = 0; s < SAMPLES; s++) {
        const k = s / SAMPLES;
        positions.push(a.x + (b.x - a.x) * k, Y, a.z + (b.z - a.z) * k);
      }
    }
    const last = pts[pts.length - 1];
    positions.push(last.x, Y, last.z);
    const total = positions.length / 3;
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo2.setDrawRange(0, 0);
    const mat2 = new THREE.LineBasicMaterial({
      color: Math.random() < 0.7 ? 0x9df0ff : 0xd9f9ff,
      transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo2, mat2);
    line.frustumCulled = false;
    scene.add(line);
    const win = SAMPLES * 2; // the glowing pulse spans ~2 edges
    fx.tween((pts.length - 1) * 0.085 + 0.3, (kk) => {
      const head = Math.floor(kk * (total + win));
      const start = Math.max(0, head - win);
      geo2.setDrawRange(start, Math.max(0, Math.min(head, total) - start));
    }, () => {
      scene.remove(line);
      geo2.dispose();
      mat2.dispose();
    });
    setTimeout(hexPulse, 1600 + Math.random() * 3200);
  };
  setTimeout(hexPulse, 1200);
}

function updateAmbient(t, dt) {
  for (let i = 0; i < ambient.pylonMats.length; i++) {
    ambient.pylonMats[i].opacity = 0.35 + 0.25 * (1 + Math.sin(t * 1.4 + i * 1.1)) / 2;
  }
  if (ambient.sparks) {
    const arr = ambient.sparks.geometry.attributes.position.array;
    for (let i = 0; i < ambient.sparkVel.length; i++) {
      arr[i * 3 + 1] += ambient.sparkVel[i] * dt;
      if (arr[i * 3 + 1] > 3.4) {
        arr[i * 3 + 1] = 0.05;
        arr[i * 3] = (Math.random() - 0.5) * 2 * ambient.extent;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 2 * ambient.extent;
      }
    }
    ambient.sparks.geometry.attributes.position.needsUpdate = true;
  }
}

// the start-screen theme can only begin after a user gesture (autoplay policy)
let menuMusicWanted = true;

function startGame(sizeKey, seed, factions, mods = null, restore = null, gameOpts = {}) {
  if (game.config) return; // already running — ignore stray menu clicks
  document.body.classList.add('in-game'); // reveals the in-game-only HUD (info icon)
  for (const m of ['startmenu', 'setupmenu', 'editor', 'mapsmenu', 'campaignmenu', 'rulesmenu']) {
    const el = document.getElementById(m);
    if (el) el.style.display = 'none';
  }
  const credit = document.getElementById('credit');
  if (credit) credit.style.display = 'none';
  audio.init();
  menuMusicWanted = false;
  audio.stopMenuTheme(); // the start-screen theme yields to the in-game score
  if (!game.sessionId) {
    game.sessionId = 's' + Date.now().toString(36) +
      Math.floor(Math.random() * 1e6).toString(36);
  }
  const R = SIZES[sizeKey].radius;
  applyRenderMode(); // modern (perspective + bloom) or classic (iso + pixel + posterize)
  scene.fog.density = classic ? 0.0025 : Math.min(0.014, 0.09 / R);
  controls.maxDistance = Math.max(42, R * 6);
  // the far clip plane must reach across the whole grid from the zoomed-out
  // camera — on the huge maps (EPIC/MANIC) the default 300 cuts off the far
  // edge. Lift the near plane in step so the wider range keeps its depth
  // precision (the camera never sits closer than minDistance, so it's safe).
  camera.near = Math.max(0.1, R * 0.012);
  camera.far = Math.max(300, R * 14);
  camera.updateProjectionMatrix();
  game.init(sizeKey, seed, factions, mods, restore, gameOpts);
  setTileBaseColor(); // the fresh tile field just built — tint it for the mode
  setupAmbient(R);

  // CLASSIC: no swooping fly-in — drop straight into the iso view, now with full
  // free orbit / zoom / pan via OrbitControls
  if (classic) {
    flyingIn = false;
    enterClassicCamera(R);
    return;
  }

  // cinematic fly-in: swoop down over the LOCAL player's corner of the grid,
  // so their army is in the foreground looking across at the enemy
  controls.enabled = false;
  flyingIn = true; // controls.update() clamps distance, so pause it mid-flight
  const humanId = (game.net && game.net.myFaction != null)
    ? game.net.myFaction
    : (game.factions.find((f) => f.controller === 'human') || {}).id;
  const dir = new THREE.Vector3(0, 0, 1); // default: faction 0's south corner
  if (humanId != null) {
    const anchor = game.coreOf(humanId) || game.aliveUnits(humanId)[0];
    if (anchor) {
      const v = new THREE.Vector3(anchor.mesh.position.x, 0, anchor.mesh.position.z);
      if (v.lengthSq() > 0.01) dir.copy(v).normalize();
    }
  }
  controls.target.set(0, 0, 0); // orbit/look at the grid centre
  // pull the camera back far enough that the WHOLE map fits the viewport at
  // the end of the zoom-in (and don't let the zoom go closer than that)
  const mapR = R * 1.8 + 1.2; // world bounding radius of the hex arena
  const vHalf = camera.fov * Math.PI / 360; // half the vertical field of view
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const fitDist = mapR / Math.sin(Math.min(vHalf, hHalf)) * 1.06;
  const endLen = R * Math.hypot(2.05, 1.85);
  const f = Math.max(1, fitDist / endLen);
  controls.maxDistance = Math.max(42, R * 6, fitDist * 1.05);
  const flightPath = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(dir.x * R * 7.5, R * 4.2, dir.z * R * 7.5).multiplyScalar(f),
    new THREE.Vector3(dir.x * R * 4.2, R * 1.1, dir.z * R * 4.2).multiplyScalar(f),
    new THREE.Vector3(dir.x * R * 2.05, R * 1.85, dir.z * R * 2.05).multiplyScalar(f)
  );
  camera.position.copy(flightPath.getPoint(0));
  camera.lookAt(controls.target);
  audio.engine(2.4);
  fx.tween(2.6, (k) => {
    const e = k * k * (3 - 2 * k); // smoothstep
    flightPath.getPoint(e, camera.position);
    camera.lookAt(controls.target);
  }, () => {
    flyingIn = false;
    controls.enabled = true;
    controls.update();
  });
}

// ---------- demo reel (attract mode) ----------
// An autonomous AI-vs-AI match with a slow cinematic orbit and timed caption
// cards narrating the game's features and strategies — built to be watched
// (or screen-recorded) as a trailer. Exit with a click or ESC.
const demo = { active: false, elapsed: 0, idx: -1, angle: 0, target: new THREE.Vector3() };

const DEMO_SCRIPT = [
  { t: 0, big: true, head: 'GRID WARS', body: 'A TRON-style turn-based hex strategy' },
  { t: 6.5, head: 'LIGHT CYCLES', body: 'Fast hit-and-run raiders that leave deadly light-walls trailing behind them' },
  { t: 13, head: 'OVERDRIVE', body: 'Run a cycle flat-out in a straight line — its strike rams home extra damage' },
  { t: 19.5, head: 'BATTLE TANKS', body: 'Turret artillery: slew the turret to aim, ram cycles, and smash clean through walls' },
  { t: 26.5, head: 'RECOGNIZERS', body: 'Heavy flyers that glide over the grid — climb high to dodge cycles, top out for +2 range' },
  { t: 34, head: 'STRIKE FROM BEHIND', body: 'Rear hits land +50% damage — flank with cycles while tanks pin the front' },
  { t: 40.5, head: 'FOCUS FIRE', body: 'Gang up on one target in a single turn for stacking bonus damage' },
  { t: 46.5, head: 'HOLD THE HEAL PADS', body: 'Park a wounded program on a green pad to repair it back to full' },
  { t: 52.5, head: 'CONQUER THE CORES', body: 'Ride a light cycle onto an enemy core to seize it and its units — take them all to win' },
  { t: 60, head: 'AND SO MUCH MORE', body: 'Campaigns, hotseat & online play, simultaneous WeGo mode, and EPIC 4000-hex grids' },
  { t: 67, big: true, head: 'GRID WARS', body: 'Enter the grid.' },
];
const DEMO_DURATION = 74;
const _demoC = new THREE.Vector3();

function startDemo() {
  if (game.config) return; // a game is already running
  audio.init();
  startGame('L', Math.floor(Math.random() * 1e9), [
    { name: 'CLU', color: 1, controller: 'ai', team: 1 },   // orange
    { name: 'TRON', color: 0, controller: 'ai', team: 2 },  // cyan
  ]);
  game.sessionId = null; // don't autosave the attract match
  demo.active = true; demo.elapsed = 0; demo.idx = -1; demo.angle = 0;
  demo.target.set(0, 0, 0);
  document.body.classList.add('demo-mode'); // hide the gameplay HUD
  const ov = document.getElementById('demo-overlay');
  ov.style.display = 'block';
  ov.onclick = stopDemo;
  document.addEventListener('keydown', demoKey);
}

function stopDemo() {
  demo.active = false;
  location.reload(); // clean reset back to the start menu
}
function demoKey(e) { if (e.key === 'Escape') stopDemo(); }

function updateDemo(t, dt) {
  if (!demo.active) return;
  demo.elapsed += dt;
  // caption timeline
  let i = -1;
  for (let k = 0; k < DEMO_SCRIPT.length; k++) if (demo.elapsed >= DEMO_SCRIPT[k].t) i = k;
  if (i !== demo.idx && i >= 0) {
    demo.idx = i;
    const card = DEMO_SCRIPT[i];
    const title = document.getElementById('demo-title');
    const cap = document.getElementById('demo-caption');
    const el = card.big ? title : cap;
    const other = card.big ? cap : title;
    other.classList.remove('show');
    el.querySelector(card.big ? '.dt-head' : '.dc-head').textContent = card.head;
    el.querySelector(card.big ? '.dt-body' : '.dc-body').textContent = card.body;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  if (demo.elapsed >= DEMO_DURATION) { stopDemo(); return; }
  if (flyingIn) return; // let the opening fly-in play as the intro shot
  game.fx.speed = 1.4; // keep the attract match lively
  // slow cinematic orbit that follows the centre of the battle
  const units = game.aliveUnits().filter((u) => u.alive);
  if (units.length) {
    _demoC.set(0, 0, 0);
    for (const u of units) _demoC.add(u.mesh.position);
    _demoC.multiplyScalar(1 / units.length); _demoC.y = 0;
    demo.target.lerp(_demoC, 0.015);
  }
  const mapR = SIZES[game.sizeKey].radius * 1.8;
  demo.angle += dt * 0.13;
  const dist = mapR * 1.95 + Math.sin(t * 0.17) * mapR * 0.5;
  const h = mapR * 1.0 + Math.sin(t * 0.1) * mapR * 0.22;
  activeCamera.position.set(
    demo.target.x + Math.cos(demo.angle) * dist, h,
    demo.target.z + Math.sin(demo.angle) * dist
  );
  activeCamera.lookAt(demo.target);
}

document.getElementById('demo-btn').addEventListener('click', startDemo);

// ---------- visual mode toggle (modern / classic 16-bit) ----------
const visualToggle = document.getElementById('visual-toggle');
function syncVisualToggle() {
  visualToggle.textContent = 'VISUALS — ' +
    (localStorage.getItem('gw-classic') === '1' ? 'CLASSIC 16-BIT' : 'MODERN');
  visualToggle.classList.toggle('on', localStorage.getItem('gw-classic') === '1');
}
syncVisualToggle();
visualToggle.addEventListener('click', () => {
  const on = localStorage.getItem('gw-classic') === '1';
  try { localStorage.setItem('gw-classic', on ? '0' : '1'); } catch (e) { /* ignore */ }
  syncVisualToggle();
  applyRenderMode(); // ready for the next game (and live, if one is running)
});

// ---------- in-game MANUAL / README screen ----------
// Reads the shipped README.md and renders it (Markdown → HTML) into a scrollable
// overlay. `marked` is imported lazily so a CDN hiccup never blocks game boot.
const manualOverlay = document.getElementById('manual-overlay');
const manualContent = document.getElementById('manual-content');
let manualLoaded = false;
async function loadManual() {
  if (manualLoaded) return;
  try {
    const [{ marked }, md] = await Promise.all([
      import('marked'),
      fetch('README.md').then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    ]);
    marked.setOptions({ gfm: true, breaks: false });
    manualContent.innerHTML = marked.parse(md);
    // open links in a new tab so the game isn't navigated away from
    manualContent.querySelectorAll('a[href]').forEach((a) => {
      a.target = '_blank'; a.rel = 'noopener';
    });
    manualLoaded = true;
  } catch (e) {
    manualContent.innerHTML = '<p style="color:#ff6a5a">Could not load the manual ('
      + e + ').<br>The README is also at '
      + '<a href="https://github.com/loosecannons/grid-wars#readme" target="_blank" rel="noopener">github.com/loosecannons/grid-wars</a>.</p>';
  }
}
function openManual() { manualOverlay.classList.add('show'); manualContent.scrollTop = 0; loadManual(); }
function closeManual() { manualOverlay.classList.remove('show'); }
document.getElementById('manual-btn').addEventListener('click', openManual);
const manualGameBtn = document.getElementById('btn-manual-game');
if (manualGameBtn) manualGameBtn.addEventListener('click', openManual);
document.getElementById('manual-close').addEventListener('click', closeManual);
manualOverlay.addEventListener('click', (e) => { if (e.target === manualOverlay) closeManual(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && manualOverlay.classList.contains('show')) { e.preventDefault(); closeManual(); }
});

// ---------- replay viewer (watch a recorded battle) ----------
const replay = { active: false, total: 1, angle: 0, target: new THREE.Vector3() };

function startReplay(rec, seekIdx = 0) {
  audio.init();
  replay.active = true;
  replay.total = Math.max(1, rec.events.length);
  replay.angle = 0; replay.target.set(0, 0, 0);
  game._replaySpeed = 1;
  game._replayRec = rec;
  game.onReplayProgress = (i) => updateReplayBar(i);
  game.onReplayDone = () => onReplayEnd();
  document.body.classList.add('replay-mode');
  document.getElementById('replay-hud').style.display = 'flex';
  // booting straight to a mid-point: cover the from-the-start fast-forward
  replay.seeking = seekIdx > 0;
  document.getElementById('replay-seeking').style.display = replay.seeking ? 'flex' : 'none';
  buildReplayMarkers(rec);
  game._replayPaused = false;
  document.getElementById('rp-play').textContent = '❚❚';
  startGame(rec.sizeKey, rec.seed, rec.configs, rec.mods || null, null, { replay: rec, seek: seekIdx });
  game.sessionId = null; // a replay is never a saved session
}

function buildReplayMarkers(rec) {
  const lane = document.getElementById('replay-markers');
  lane.innerHTML = '';
  for (const m of rec.markers || []) {
    const tick = document.createElement('div');
    tick.className = 'rp-mark';
    tick.style.left = (100 * m.i / Math.max(1, rec.events.length)) + '%';
    tick.style.background = m.color || '#fff';
    tick.title = m.label;
    lane.appendChild(tick);
  }
}

function updateReplayBar(i) {
  document.getElementById('replay-fill').style.width = (100 * i / replay.total) + '%';
  document.getElementById('replay-time').textContent = i + ' / ' + replay.total;
  // the fast-forward (after a reload-seek) has caught up — lift the cover
  if (replay.seeking && !game._fast) {
    replay.seeking = false;
    document.getElementById('replay-seeking').style.display = 'none';
  }
}

function setReplaySpeed(s) {
  game._replaySpeed = s;
  if (!game._fast) game.fx.speed = s;
  for (const b of document.querySelectorAll('#rp-speeds button')) {
    b.classList.toggle('on', +b.dataset.spd === s);
  }
}

function onReplayEnd() {
  document.getElementById('rp-play').textContent = '▶';
  game._replayPaused = true;
  updateReplayBar(replay.total);
}

function replaySeek(idx) {
  idx = Math.max(0, Math.min(replay.total, idx));
  if (idx >= game._evIdx && !game.over) {
    // forward: fast-forward in place — no reload, no visible restart
    game._fastTarget = idx;
    game._fast = true;
    game._replayPaused = false;
    game.fx.speed = 140;
    document.getElementById('rp-play').textContent = '❚❚';
  } else {
    // backward (or after the end): the engine must re-simulate from the start,
    // so cover it with a brief "SEEKING" wipe instead of replaying on screen
    document.getElementById('replay-seeking').style.display = 'flex';
    try {
      sessionStorage.setItem('gw-replay', JSON.stringify({ rec: game._replayRec, seek: idx }));
    } catch (e) { /* too big to seek */ }
    location.reload();
  }
}

function saveReplay(rec) {
  let all = [];
  try { all = JSON.parse(localStorage.getItem('gw-replays') || '[]'); } catch (e) { /* fresh */ }
  if (all.some((r) => r.ts === rec._savedTs)) return; // already saved this one
  rec._savedTs = Date.now();
  all.unshift({
    id: 'r' + rec._savedTs.toString(36),
    ts: rec._savedTs,
    label: SIZES[rec.sizeKey].label + ' · '
      + rec.configs.map((c) => c.name).join(' v ') + ' · '
      + (rec.winner ? rec.winner + ' wins' : 'draw'),
    rec,
  });
  all = all.slice(0, 12); // keep the latest dozen
  try { localStorage.setItem('gw-replays', JSON.stringify(all)); } catch (e) { /* full */ }
}

function loadReplays() {
  try { return JSON.parse(localStorage.getItem('gw-replays') || '[]'); }
  catch (e) { return []; }
}

// replay HUD controls
document.getElementById('rp-play').addEventListener('click', () => {
  if (game.over && game._evIdx >= replay.total) { replaySeek(0); return; } // restart when finished
  game._replayPaused = !game._replayPaused;
  document.getElementById('rp-play').textContent = game._replayPaused ? '▶' : '❚❚';
});
document.getElementById('rp-restart').addEventListener('click', () => replaySeek(0));
document.getElementById('rp-exit').addEventListener('click', () => location.reload());
// play this exact map fresh as a new, playable game (same size/seed/factions
// and turn mode) — mirrors restartSameMap, sourced from the replay record
document.getElementById('rp-newgame').addEventListener('click', () => {
  const rec = game._replayRec;
  if (!rec) return;
  if (rec.mission) {
    sessionStorage.setItem('gw-mission', JSON.stringify(rec.mission));
  } else {
    sessionStorage.setItem('gw-restart', JSON.stringify({
      size: rec.sizeKey, seed: rec.seed, factions: rec.configs,
      simultaneous: rec.simultaneous, perUnitInit: rec.perUnitInit,
      rules: rec.rules || null,
    }));
  }
  location.reload();
});
for (const b of document.querySelectorAll('#rp-speeds button')) {
  b.addEventListener('click', () => setReplaySpeed(+b.dataset.spd));
}
document.getElementById('replay-track').addEventListener('click', (ev) => {
  const rect = ev.currentTarget.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
  replaySeek(Math.round(frac * replay.total));
});

// cinematic orbit over the battle — same feel as the demo reel
function updateReplayCamera(t, dt) {
  if (flyingIn) return;
  const units = game.aliveUnits().filter((u) => u.alive);
  if (units.length) {
    _demoC.set(0, 0, 0);
    for (const u of units) _demoC.add(u.mesh.position);
    _demoC.multiplyScalar(1 / units.length); _demoC.y = 0;
    replay.target.lerp(_demoC, 0.02);
  }
  const mapR = SIZES[game.sizeKey].radius * 1.8;
  replay.angle += dt * 0.1;
  const dist = mapR * 1.9 + Math.sin(t * 0.16) * mapR * 0.45;
  const h = mapR * 1.0 + Math.sin(t * 0.09) * mapR * 0.2;
  activeCamera.position.set(
    replay.target.x + Math.cos(replay.angle) * dist, h,
    replay.target.z + Math.sin(replay.angle) * dist
  );
  activeCamera.lookAt(replay.target);
}

// ---------- replays browse screen ----------
function showReplaysMenu() {
  ui.revealScreen('replaysmenu'); // fly-through from the current menu
  const list = document.getElementById('replays-list');
  list.innerHTML = '';
  const all = loadReplays();
  if (!all.length) {
    const e = document.createElement('div');
    e.className = 'rp-empty';
    e.textContent = 'NO SAVED REPLAYS YET — SAVE ONE FROM A FINISHED BATTLE';
    list.appendChild(e);
    return;
  }
  for (const r of all) {
    const row = document.createElement('div');
    row.className = 'rp-row';
    const play = document.createElement('button');
    play.className = 'play';
    play.innerHTML = esc(r.label) + '<span>' + new Date(r.ts).toLocaleString() + '</span>';
    play.addEventListener('click', () => {
      try {
        sessionStorage.setItem('gw-replay', JSON.stringify({ rec: r.rec, seek: 0 }));
      } catch (e) { /* too big */ }
      location.reload();
    });
    const del = document.createElement('button');
    del.className = 'small del';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const left = loadReplays().filter((x) => x.id !== r.id);
      try { localStorage.setItem('gw-replays', JSON.stringify(left)); } catch (e) { /* ignore */ }
      showReplaysMenu();
    });
    row.appendChild(play);
    row.appendChild(del);
    list.appendChild(row);
  }
}
function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
document.getElementById('replays-btn').addEventListener('click', showReplaysMenu);
document.getElementById('replays-back').addEventListener('click', () => {
  ui._navBack = true; // reverse (fly-back-out) transition to the start menu
  ui.showStartMenu();
});

// ---------- map editor & custom maps ----------
let mapEditor = null;
function openEditor(loadMap) {
  if (!mapEditor) {
    mapEditor = new MapEditor(document.getElementById('editor-body'), {
      onPlay: (map) => playCustomMap(map, true), // test-drive: offer "return to editor"
      onSave: (map) => saveMapToServer(map),
      onClose: () => { ui._navBack = true; ui.showStartMenu(); },
    });
    window.__mapEditor = mapEditor; // debug handle
  }
  ui.revealScreen('editor');
  if (loadMap) mapEditor.load(loadMap);
}
async function saveMapToServer(map) {
  try {
    const r = await fetch('/api/maps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(map),
    });
    return r.ok;
  } catch (e) { return false; }
}
// Boot a game from a custom map: its faction setup becomes the combatants and
// its terrain + placements override the procedural generation.
function playCustomMap(map, fromEditor) {
  const configs = (map.factions || []).map((f, i) => ({
    name: f.name || ('PROGRAM ' + (i + 1)),
    color: f.color || 0,
    controller: f.controller || (i === 0 ? 'human' : 'ai'),
    team: f.team || (i + 1),
  }));
  if (configs.length < 2 || !SIZES[map.sizeKey]) return;
  game.mission = null;
  game.sessionId = null; // a custom-map game is its own session
  // a test-drive from the editor stashes its map so MENU → EDITOR can return to it
  try {
    if (fromEditor) sessionStorage.setItem('gw-editor-map', JSON.stringify(map));
    else sessionStorage.removeItem('gw-editor-map');
  } catch (e) { /* ignore */ }
  const seed = Math.floor(Math.random() * 1e9);
  const mode = localStorage.getItem('gw-turnmode') || 'seq';
  startGame(map.sizeKey, seed, configs, null, null,
    { customMap: map, simultaneous: mode === 'sim', perUnitInit: mode === 'init' });
  const back = document.getElementById('btn-toeditor');
  if (back) back.style.display = fromEditor ? 'block' : 'none';
}

function showMapsMenu() {
  ui.revealScreen('mapsmenu');
  const list = document.getElementById('maps-list');
  list.innerHTML = '<div class="rp-empty">LOADING GRIDS…</div>';
  fetch('/api/maps').then((r) => r.json()).then(({ maps }) => {
    list.innerHTML = '';
    if (!maps || !maps.length) {
      list.innerHTML = '<div class="rp-empty">NO SAVED MAPS YET — BUILD ONE IN THE EDITOR, OR SAVE A GENERATED GRID FROM THE IN-GAME MENU</div>';
      return;
    }
    for (const m of maps) {
      const row = document.createElement('div');
      row.className = 'rp-row';
      const play = document.createElement('button');
      play.className = 'play';
      play.innerHTML = esc(m.name) + '<span>' + esc(m.sizeKey || '?') + ' · ' + m.factions + ' FACTIONS · ' + m.units + ' UNITS</span>';
      play.addEventListener('click', () => {
        fetch('/api/maps/' + m.id).then((r) => r.json()).then((full) => playCustomMap(full));
      });
      const edit = document.createElement('button');
      edit.className = 'small';
      edit.textContent = 'EDIT';
      edit.addEventListener('click', () => {
        fetch('/api/maps/' + m.id).then((r) => r.json()).then((full) => openEditor(full));
      });
      const del = document.createElement('button');
      del.className = 'small del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        fetch('/api/maps/' + m.id, { method: 'DELETE' }).then(() => showMapsMenu());
      });
      row.appendChild(play); row.appendChild(edit); row.appendChild(del);
      list.appendChild(row);
    }
  }).catch(() => {
    list.innerHTML = '<div class="rp-empty">COULD NOT REACH THE MAP SERVER</div>';
  });
}

// Save the CURRENT (often procedurally-generated) grid as a custom map.
async function saveCurrentMap() {
  if (!game.config) return;
  const name = (window.prompt('Save this grid as a map. Name:', 'GRID ' + (game.sizeKey || '')) || '').trim();
  if (!name) return;
  const map = game.exportMap(name);
  const ok = await saveMapToServer(map);
  ui.showBanner(ok ? 'MAP SAVED' : 'SAVE FAILED', ok ? '#3dff7c' : '#ff5544', 1700);
}

document.getElementById('editor-btn').addEventListener('click', () => openEditor());
document.getElementById('maps-btn').addEventListener('click', showMapsMenu);
document.getElementById('maps-back').addEventListener('click', () => { ui._navBack = true; ui.showStartMenu(); });
document.getElementById('btn-savemap').addEventListener('click', saveCurrentMap);
// return to the editor from a test-drive: reload (the app leaves games by
// reloading) and reopen the editor with the stashed map
document.getElementById('btn-toeditor').addEventListener('click', () => {
  try {
    sessionStorage.setItem('gw-reopen-editor', '1');
    sessionStorage.setItem('gw-nav-back', '1');
  } catch (e) { /* ignore */ }
  document.body.classList.add('flying-out');
  setTimeout(() => location.reload(), 400);
});

// ---------- sessions: several games may be open at once ----------

function loadSessions() {
  try { return JSON.parse(localStorage.getItem('gw-sessions') || '{}'); }
  catch (e) { return {}; }
}

function saveSessions(all) {
  try { localStorage.setItem('gw-sessions', JSON.stringify(all)); }
  catch (e) { /* storage full — sessions are a convenience, not critical */ }
}

game.onAutosave = () => {
  if (game.net && !game.net.isHost) return; // the host owns the session file
  if (!game.config || game.over || !game.sessionId) return;
  const all = loadSessions();
  const vs = game.factions.map((f) =>
    (f.controller === 'human' ? f.name : f.name + '·MCP')).join(' vs ');
  all[game.sessionId] = {
    t: Date.now(),
    label: SIZES[game.sizeKey].label + ' · ' + vs + ' · CYCLE ' + game.cycleNum
      + (game.mission ? ' · ' + CAMPAIGNS[game.mission.cid].missions[game.mission.idx].title : ''),
    state: game.serialize(),
  };
  // keep only the 8 most recent sessions
  const ids = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
  for (const id of ids.slice(8)) delete all[id];
  saveSessions(all);
};

game.onGameOver = () => {
  // reveal the replay options on the game-over screen if this game was recorded
  const rec = game.recording;
  if (rec && rec.over && rec.events.length) {
    const watch = document.getElementById('btn-watch-replay');
    const save = document.getElementById('btn-save-replay');
    watch.style.display = 'inline-block';
    save.style.display = 'inline-block';
    save.textContent = 'SAVE REPLAY';
  }
  if (!game.sessionId) return;
  const all = loadSessions();
  delete all[game.sessionId];
  saveSessions(all);
};

document.getElementById('btn-watch-replay').addEventListener('click', () => {
  if (!game.recording) return;
  try {
    sessionStorage.setItem('gw-replay', JSON.stringify({ rec: game.recording, seek: 0 }));
  } catch (e) { /* too large */ }
  location.reload();
});
document.getElementById('btn-save-replay').addEventListener('click', (e) => {
  if (!game.recording) return;
  saveReplay(game.recording);
  e.target.textContent = 'SAVED ✓';
});

function resumeSession(id) {
  const s = loadSessions()[id];
  if (!s || !s.state) return;
  game.sessionId = id;
  if (s.state.mission) game.mission = s.state.mission;
  startGame(s.state.sizeKey, s.state.seed, s.state.configs, s.state.mods, s.state);
}

function deleteSession(id) {
  const all = loadSessions();
  delete all[id];
  saveSessions(all);
}

// ---------- campaigns & start flow ----------

function launchMission(cid, idx) {
  const m = CAMPAIGNS[cid] && CAMPAIGNS[cid].missions[idx];
  if (!m) return;
  game.mission = { cid, idx };
  // campaigns honour the player's chosen turn mode — except the tutorial, whose
  // lessons are built around sequential, turn-by-turn play
  let opts = {};
  if (cid !== 'tutorial') {
    const mode = localStorage.getItem('gw-turnmode') || 'seq';
    opts = { simultaneous: mode === 'sim', perUnitInit: mode === 'init' };
  }
  startGame(m.size, m.seed, m.factions.map((f) => ({ ...f })), m.mods || null, null, opts);
}

// Easter egg: clearing the FINAL Grid War mission "crashes" the system — a
// Windows blue screen in dark mode, an Amiga Guru Meditation in light mode.
// Either is dismissed with a click (the blue screen also takes any key).
function showVictoryCrash() {
  if (document.body.classList.contains('light')) showGuruMeditation();
  else showBlueScreen();
}
function showBlueScreen() {
  const el = document.getElementById('bsod');
  el.classList.add('show');
  const off = () => {
    el.classList.remove('show');
    el.removeEventListener('click', off);
    window.removeEventListener('keydown', off);
  };
  el.addEventListener('click', off);
  window.addEventListener('keydown', off);
}
function showGuruMeditation() {
  const el = document.getElementById('guru');
  el.classList.add('show');
  document.body.classList.add('guru-shift'); // push the rest of the screen down
  const off = () => {
    el.classList.remove('show');
    document.body.classList.remove('guru-shift');
    el.removeEventListener('click', off);
  };
  el.addEventListener('click', off);
}

// winning a campaign mission unlocks the next and offers it on the game-over screen
game.onMissionEnd = (won) => {
  if (!game.mission) return;
  const { cid, idx } = game.mission;
  if (won) {
    let progress = {};
    try { progress = JSON.parse(localStorage.getItem('gw-progress') || '{}'); } catch (e) { /* fresh */ }
    progress[cid] = Math.max(progress[cid] || 0, idx + 1);
    try { localStorage.setItem('gw-progress', JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }
  const hasNext = won && CAMPAIGNS[cid].missions[idx + 1];
  document.getElementById('btn-nextmission').style.display = hasNext ? 'block' : 'none';
  // beating the last Grid War mission triggers the retro "crash" gag
  if (won && cid === 'grid_war' && !hasNext) setTimeout(showVictoryCrash, 2400);
};

// a same-map restart carries everything (mission or skirmish) across the reload
const newGameFlow = () =>
  ui.showStartMenu(
    (sizeKey, factions, opts) =>
      startGame(sizeKey, Math.floor(Math.random() * 1e9), factions, null, null, opts),
    (cid, idx) => launchMission(cid, idx),
    {
      sessions: loadSessions(),
      onResume: (id) => resumeSession(id),
      onDelete: (id) => { deleteSession(id); newGameFlow(); },
    },
    (sizeKey, factions) => openLobby(sizeKey, factions)
  );

// ---------- pre-game lobby (host side) ----------

function buildLobbyRoster(configs, assignments) {
  const firstHuman = configs.findIndex((c) => c.controller !== 'ai');
  return configs.map((c, i) => {
    const pal = COLOR_PALETTE[c.color % COLOR_PALETTE.length];
    let status;
    if (c.controller === 'ai') status = 'MCP';
    else if (i === firstHuman) status = 'HOST';
    else status = assignments[i] !== undefined ? 'CONNECTED' : 'OPEN SLOT';
    return { name: c.name, css: pal.css, status };
  });
}

async function openLobby(sizeKey, configs, opts = {}) {
  const net = new Net(game, ui);
  try {
    await net.host();
  } catch (e) {
    ui.openChat();
    ui.addChat('SYSTEM', '#ff5544',
      'MULTIPLAYER NEEDS THE NODE SERVER — RUN: node server.js', false);
    newGameFlow();
    return;
  }
  game.net = net;
  net.lobbyConfig = { sizeKey, configs, opts };
  net.onRoster = () => ui.updateLobbyRoster(buildLobbyRoster(configs, net.assignments));
  ui.showLobby({
    mode: 'host',
    room: net.room,
    urls: net.inviteUrls(),
    roster: buildLobbyRoster(configs, net.assignments),
    onStart: () => {
      const seed = Math.floor(Math.random() * 1e9);
      net.startNetGame(seed);
      ui.hideLobby();
      startGame(sizeKey, seed, configs, null, null, opts);
    },
    onClose: () => location.reload(),
  });
}

// joining or spectating a networked game via invite URL
const urlParams = new URLSearchParams(location.search);
const joinRoom = urlParams.get('join');
const watchRoom = urlParams.get('watch');

async function joinNetworkGame(room, role) {
  const net = new Net(game, ui);
  game.net = net;
  try {
    const welcome = await net.join(room, role);
    if (!welcome) {
      game.net = null;
      newGameFlow();
      return;
    }
    if (welcome.lobby) {
      // pre-game lobby: show the roster and wait for the host to start
      const cfgs = welcome.configs;
      net.onRoster = () => ui.updateLobbyRoster(buildLobbyRoster(cfgs, net.assignments));
      ui.showLobby({
        mode: 'guest',
        room: net.room,
        urls: net.inviteUrls(),
        roster: buildLobbyRoster(cfgs, net.assignments),
        onClose: () => location.reload(),
      });
      net.onStart = (cfg) => {
        ui.hideLobby();
        startGame(cfg.sizeKey, cfg.seed, cfg.configs, null, null, cfg.opts || {});
        net.setReady();
        ui.addChat('SYSTEM', '#7dffc8', 'THE GRID IS LIVE.', false);
      };
      return;
    }
    if (!welcome.snapshot) {
      game.net = null;
      newGameFlow();
      return;
    }
    const s = welcome.snapshot;
    game.mission = s.mission || null;
    startGame(s.sizeKey, s.seed, s.configs, s.mods, s);
    net.setReady();
    ui.addChat('SYSTEM', '#e8f6ff',
      role === 'play' ? 'YOU HAVE JOINED THE GRID.' : 'SPECTATING THE GRID.', false);
  } catch (e) {
    game.net = null;
    ui.addChat('SYSTEM', '#ff5544', 'RELAY UNREACHABLE — IS server.js RUNNING?', false);
    newGameFlow();
  }
}

const missionInfo = sessionStorage.getItem('gw-mission');
const restartInfo = sessionStorage.getItem('gw-restart');
const replayInfo = sessionStorage.getItem('gw-replay');
// A quit-to-menu reloads the page; this flag tells the start menu to swing in
// with the reverse (fly-back-out) transition rather than the forward fly-in.
if (sessionStorage.getItem('gw-nav-back')) {
  sessionStorage.removeItem('gw-nav-back');
  ui._navBack = true;
}
if (joinRoom || watchRoom) {
  joinNetworkGame(joinRoom || watchRoom, joinRoom ? 'play' : 'watch');
} else if (replayInfo) {
  sessionStorage.removeItem('gw-replay');
  try {
    const { rec, seek } = JSON.parse(replayInfo);
    startReplay(rec, seek || 0);
  } catch (e) { newGameFlow(); }
} else if (missionInfo) {
  sessionStorage.removeItem('gw-mission');
  try {
    const { cid, idx } = JSON.parse(missionInfo);
    const m = CAMPAIGNS[cid].missions[idx];
    ui.showBriefing(m, () => launchMission(cid, idx),
      () => { ui._navBack = true; newGameFlow(); });
  } catch (e) {
    newGameFlow();
  }
} else if (restartInfo) {
  sessionStorage.removeItem('gw-restart');
  try {
    const { size, seed, factions, simultaneous, perUnitInit, rules } = JSON.parse(restartInfo);
    if (!Array.isArray(factions) || factions.length < 2) throw new Error('bad restart');
    startGame(size, seed, factions, null, null,
      { simultaneous: !!simultaneous, perUnitInit: !!perUnitInit, rules: rules || null });
  } catch (e) {
    newGameFlow();
  }
} else if (sessionStorage.getItem('gw-reopen-editor')) {
  // returning from a test-drive — set up the start menu (so the editor's CLOSE
  // has somewhere to go), then reopen the editor with the stashed map
  sessionStorage.removeItem('gw-reopen-editor');
  newGameFlow();
  try {
    const map = JSON.parse(sessionStorage.getItem('gw-editor-map') || 'null');
    openEditor(map || undefined);
  } catch (e) { /* the start menu is already shown */ }
} else {
  newGameFlow();
}

function restartSameMap() {
  if (!game.config) return;
  if (game.sessionId) deleteSession(game.sessionId); // the restart replaces it
  if (game.mission) {
    sessionStorage.setItem('gw-mission', JSON.stringify(game.mission));
  } else {
    sessionStorage.setItem('gw-restart', JSON.stringify({
      size: game.sizeKey, seed: game.seed, factions: game.factionConfigs,
      simultaneous: game.simultaneous, perUnitInit: game.perUnitInit,
      rules: game.rules || null,
    }));
  }
  location.reload();
}

// host a networked room for the current game — friends join/watch by URL.
// Shows the lobby dialog (visible regardless of chat state).
document.getElementById('btn-invite').addEventListener('click', async () => {
  if (!game.config || game.over) return;
  if (!game.net) {
    const net = new Net(game, ui);
    try {
      await net.host();
      game.net = net;
    } catch (e) {
      ui.openChat();
      ui.addChat('SYSTEM', '#ff5544',
        'MULTIPLAYER NEEDS THE NODE SERVER — RUN: node server.js', false);
      return;
    }
  }
  const net = game.net;
  const roster = () => buildLobbyRoster(game.factionConfigs, net.assignments);
  net.onRoster = () => ui.updateLobbyRoster(roster());
  ui.showLobby({
    mode: 'ingame',
    room: net.room,
    urls: net.inviteUrls(),
    roster: roster(),
  });
});

document.getElementById('btn-nextmission').addEventListener('click', () => {
  if (!game.mission) return;
  sessionStorage.setItem('gw-mission', JSON.stringify({
    cid: game.mission.cid, idx: game.mission.idx + 1,
  }));
  location.reload();
});

ui.onBuild((type) => game.playerBuild(type));
ui.onTurret((dir) => game.playerRotateTurret(dir));
ui.onAltitude((dir) => game.playerSetAltitude(dir));
ui.onPush(() => game.playerTogglePush());
ui.onConquer(() => game.playerConquer());
ui.onChat((text) => game.playerChat(text));
ui.endTurnBtn.addEventListener('click', () => game.endPlayerTurn());
document.getElementById('btn-next').addEventListener('click', () => game.selectNextReady());
document.getElementById('btn-undo').addEventListener('click', () => game.undoLastMove());
document.getElementById('btn-restart-map').addEventListener('click', restartSameMap);
document.getElementById('btn-quit').addEventListener('click', () => {
  // fly back out of the grid: recede + fade the game view, then reload into the
  // start menu (which swings in via the reverse transition — see gw-nav-back).
  try { sessionStorage.setItem('gw-nav-back', '1'); } catch (e) { /* ignore */ }
  document.body.classList.add('flying-out');
  setTimeout(() => location.reload(), 400);
});
document.getElementById('btn-newgrid').addEventListener('click', () => location.reload());

window.addEventListener('keydown', (ev) => {
  const typing = ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName);
  if (ev.key === 'Tab') {
    ev.preventDefault();
    game.selectNextReady();
    return;
  }
  // Ctrl/Cmd+Z — take back the last clean unit move
  if (!typing && (ev.key === 'z' || ev.key === 'Z') && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    game.undoLastMove();
    return;
  }
});

// smooth-pan the camera to a unit (NEXT UNIT, undo, focus). Translate the
// camera AND the orbit target by the SAME delta so the view direction and
// distance are unchanged — a pure pan, never a rotation (which disorients).
game.onFocus = (unit) => {
  const fromT = controls.target.clone();
  const toT = new THREE.Vector3(unit.mesh.position.x, 0, unit.mesh.position.z);
  const delta = toT.clone().sub(fromT);
  if (delta.lengthSq() < 1e-6) return;
  const fromCam = activeCamera.position.clone(); // iso or perspective
  fx.tween(0.35, (k) => {
    controls.target.copy(fromT).addScaledVector(delta, k);
    activeCamera.position.copy(fromCam).addScaledVector(delta, k);
  });
};
function applyMute(m) {
  audio.setMuted(m);
  ui.muteBtn.classList.toggle('muted', m);
  ui.muteBtn.title = m ? 'Sound off — click to unmute' : 'Sound on — click to mute';
  localStorage.setItem('gw-muted', m ? '1' : '0');
}
ui.muteBtn.addEventListener('click', () => {
  audio.init();
  applyMute(!audio.muted);
});
// restore persisted preference on load (visual state; gain applies once audio inits)
applyMute(localStorage.getItem('gw-muted') === '1');

// top-right info icon: show/hide the on-screen instructions cheat-sheet
const helpBtn = document.getElementById('btn-help');
const helpEl = document.getElementById('help');
function applyHelp(show) {
  helpEl.style.display = show ? '' : 'none';
  helpBtn.classList.toggle('off', !show);
  helpBtn.title = show ? 'Hide instructions' : 'Show instructions';
  localStorage.setItem('gw-help', show ? '1' : '0');
}
helpBtn.addEventListener('click', () => applyHelp(helpEl.style.display === 'none'));
applyHelp(localStorage.getItem('gw-help') !== '0'); // default: shown
document.getElementById('btn-restart').addEventListener('click', () => restartSameMap());
window.addEventListener('pointerdown', () => {
  audio.init();
  if (menuMusicWanted) audio.startMenuTheme();
}, { once: true });

// ---------- picking ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let isoDrag = null; // classic-mode drag-to-rotate state

function pick(ev) {
  pointer.x = (ev.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, activeCamera);
  const hits = raycaster.intersectObjects(game.pickMeshes, true);
  for (const h of hits) {
    // the instanced floor reports the cell via its instanceId
    if (h.object.userData.keys && h.instanceId != null) {
      const ck = h.object.userData.keys[h.instanceId];
      if (ck) return { cellKey: ck };
    }
    let o = h.object;
    while (o) {
      if (o.userData.unitId != null) return { unitId: o.userData.unitId };
      if (o.userData.cellKey) return { cellKey: o.userData.cellKey };
      o = o.parent;
    }
  }
  return null;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  downPos = { x: ev.clientX, y: ev.clientY };
});

renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downPos) return;
  const dx = ev.clientX - downPos.x, dy = ev.clientY - downPos.y;
  downPos = null;
  const touch = ev.pointerType === 'touch';
  // a finger tap wanders more than a mouse click — allow a larger slop on touch
  const slop = touch ? 144 : 36;
  if (dx * dx + dy * dy > slop) return; // it was a camera drag, not a tap
  game.onPick(pick(ev), touch);
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  // touch has no real hover — a finger "move" is an orbit drag, so skip hover
  // tinting/preview for it (the tap-to-confirm flow shows previews instead)
  if (ev.pointerType === 'touch') return;
  const interactive = game.onHover(pick(ev));
  renderer.domElement.style.cursor = interactive ? 'pointer' : 'default';
});

// ---------- resize & loop ----------

window.addEventListener('resize', () => { resizeRender(); });

const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (demo.active) updateDemo(t, dt);
  else if (replay.active) updateReplayCamera(t, dt);
  else if (!flyingIn) controls.update(); // OrbitControls drives both modern & classic
  fx.update(dt);
  game.updateIdle(t);
  ui.updatePreview(dt);
  updateAmbient(t, dt);

  const shakeOff = fx.getShakeOffset();
  activeCamera.position.add(shakeOff);
  composer.render();
  activeCamera.position.sub(shakeOff);
}

loop();
ui.hideLoading();

window.__game = game; // debug handle
window.__camera = activeCamera; // debug handle (tracks modern/classic camera)
window.__renderer = renderer; // debug handle (for on-demand frame capture)
window.__composer = composer;  // debug handle (force a composite + read the canvas)

// ---------- "new version available" check ----------
// Ask GitHub for the latest release and, if it's newer than this build, show a
// small dismissible pill on the start screen. Cached for a few hours; any
// failure (offline, rate-limited) is silently ignored.
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function showUpdateNotice(latest) {
  if (localStorage.getItem('gw-upd-dismiss') === latest) return; // user dismissed this one
  const el = document.getElementById('update-notice');
  el.querySelector('.uv').textContent = 'v' + latest;
  document.getElementById('update-link').href = 'https://github.com/' + REPO + '/releases/latest';
  el.classList.add('show');
  document.getElementById('update-dismiss').onclick = () => {
    el.classList.remove('show');
    try { localStorage.setItem('gw-upd-dismiss', latest); } catch (e) { /* ignore */ }
  };
}
async function checkForUpdate() {
  try {
    const TTL = 6 * 3600 * 1000; // re-check at most every 6h
    const last = +(localStorage.getItem('gw-upd-checked') || 0);
    let latest = localStorage.getItem('gw-upd-latest');
    if (!latest || Date.now() - last > TTL) {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      latest = String((await r.json()).tag_name || '').replace(/^v/, '');
      try {
        localStorage.setItem('gw-upd-latest', latest);
        localStorage.setItem('gw-upd-checked', String(Date.now()));
      } catch (e) { /* ignore */ }
    }
    if (latest && cmpVersion(latest, VERSION) > 0) showUpdateNotice(latest);
  } catch (e) { /* offline / blocked — no notice */ }
}
checkForUpdate();
