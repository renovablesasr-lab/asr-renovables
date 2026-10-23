/**
 * Escena 3D: un día de energía en Ciudad Juárez.
 *
 * Un barrio de techos planos (como los de las fotos reales de ASR) con
 * estructuras de paneles solares, una nave industrial cubierta de paneles,
 * la sierra al fondo y un sol que cruza el cielo de amanecer a atardecer
 * conforme el usuario hace scroll. Cada techo "se instala" con paneles a
 * medida que avanza la historia.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- utilidades ---------- */

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/* Paleta del cielo según la elevación del sol */
const SKY = {
  nightTop: new THREE.Color('#070b1a'),
  dawnTop: new THREE.Color('#1b2a4f'),
  dayTop: new THREE.Color('#2a64a8'),
  dawnHorizon: new THREE.Color('#f08a3c'),
  dayHorizon: new THREE.Color('#a8c6dc'),
  dawnGround: new THREE.Color('#3a2a22'),
  dayGround: new THREE.Color('#8a7a66'),
  sunLow: new THREE.Color('#ff9a4a'),
  sunHigh: new THREE.Color('#fff4e0'),
};

/* ---------- texturas procedurales ---------- */

function panelTexture(maxAniso) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  // marco de aluminio
  g.fillStyle = '#c9ced6';
  g.fillRect(0, 0, c.width, c.height);
  const panels = 4;
  const pw = c.width / panels;
  for (let p = 0; p < panels; p++) {
    const x0 = p * pw + 4;
    const w = pw - 8;
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, '#16284a');
    grad.addColorStop(1, '#0a1630');
    g.fillStyle = grad;
    g.fillRect(x0, 6, w, c.height - 12);
    // celdas 6 x 10
    g.strokeStyle = 'rgba(120,150,200,0.35)';
    g.lineWidth = 1;
    const cols = 6;
    const rows = 10;
    for (let i = 1; i < cols; i++) {
      const x = x0 + (w / cols) * i;
      g.beginPath();
      g.moveTo(x, 6);
      g.lineTo(x, c.height - 6);
      g.stroke();
    }
    for (let j = 1; j < rows; j++) {
      const y = 6 + ((c.height - 12) / rows) * j;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + w, y);
      g.stroke();
    }
    // bus bars
    g.strokeStyle = 'rgba(200,210,230,0.18)';
    for (let i = 0; i < cols; i++) {
      const x = x0 + (w / cols) * (i + 0.5);
      g.beginPath();
      g.moveTo(x, 6);
      g.lineTo(x, c.height - 6);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // ventanas
  g.fillStyle = '#5d646c';
  g.fillRect(14, 40, 26, 30);
  g.fillRect(88, 40, 26, 30);
  g.fillStyle = '#6b5a4a';
  g.fillRect(52, 60, 24, 68);
  // franja de pretil (parapeto)
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 128, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- escena ---------- */

export function createScene(canvas, opts = {}) {
  const lowPower =
    opts.lowPower ??
    (window.matchMedia('(max-width: 820px)').matches ||
      (navigator.hardwareConcurrency || 8) <= 4);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowPower,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.25 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.0042);

  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.5,
    2200
  );

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const rand = mulberry32(20260114);

  /* ----- cielo ----- */
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: 1 },
    uStars: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // siempre al fondo
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uGround, uSunColor, uSunDir;
      uniform float uGlow, uStars;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.42, h), 0.75));
        col = mix(col, uGround, smoothstep(0.0, -0.12, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        // halo amplio en el horizonte (amanecer/atardecer)
        col += uSunColor * pow(s, 9.0) * 0.45 * uGlow * (1.0 - smoothstep(0.0, 0.35, h));
        col += uSunColor * pow(s, 64.0) * 0.6;
        // disco solar
        col += uSunColor * smoothstep(0.9993, 0.9997, s) * 6.0;
        // estrellas
        if (uStars > 0.0 && h > 0.05) {
          vec3 q = floor(d * 380.0);
          float st = step(0.9975, hash(q));
          col += vec3(st) * uStars * smoothstep(0.05, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // escena de cielo sola para generar el mapa de entorno (reflejos en paneles)
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.geometry, skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  let lastEnvT = -1;

  /* ----- luces ----- */
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = !lowPower;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -170;
  sc.right = 170;
  sc.top = 170;
  sc.bottom = -170;
  sc.near = 10;
  sc.far = 700;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd3ff, 0x4a3a2a, 0.6);
  scene.add(hemi);

  /* ----- suelo y sierra ----- */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1400, 64),
    new THREE.MeshStandardMaterial({ color: '#6e5d4b', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.95 })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.02;
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const mountainMat = new THREE.MeshStandardMaterial({
    color: '#5a4a52',
    roughness: 1,
    flatShading: true,
  });
  const mountains = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    // arco de la sierra: del suroeste al norte (Sierra de Juárez / Franklin)
    const a = lerp(Math.PI * 0.55, Math.PI * 1.65, i / 25) + (rand() - 0.5) * 0.12;
    const dist = 420 + rand() * 160;
    const hgt = 28 + rand() * 52;
    const rad = 80 + rand() * 90;
    const segs = 5 + Math.floor(rand() * 3);
    // abrimos un hueco al poniente para ver el sol ocultarse en el horizonte
    if (Math.abs(a - Math.PI) < 0.3) continue;
    const geo = new THREE.ConeGeometry(rad, hgt, segs, 3);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      if (pos.getY(v) > -hgt / 2 + 0.1) {
        pos.setX(v, pos.getX(v) + (rand() - 0.5) * rad * 0.35);
        pos.setZ(v, pos.getZ(v) + (rand() - 0.5) * rad * 0.35);
        pos.setY(v, pos.getY(v) + (rand() - 0.5) * hgt * 0.15);
      }
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mountainMat);
    m.position.set(Math.cos(a) * dist, hgt / 2 - 4, Math.sin(a) * dist);
    m.rotation.y = rand() * Math.PI;
    mountains.add(m);
  }
  scene.add(mountains);

  /* ----- ciudad ----- */
  const BLOCKS = lowPower ? 2 : 3; // bloques a cada lado del centro
  const LOT_W = 11;
  const LOT_D = 13;
  const STREET = 12;
  const BLOCK_W = LOT_W * 3;
  const BLOCK_D = LOT_D * 2;
  const PITCH_X = BLOCK_W + STREET;
  const PITCH_Z = BLOCK_D + STREET;
  const span = (2 * BLOCKS + 1);
  asphalt.scale.set(span * PITCH_X + STREET, span * PITCH_Z + STREET, 1);

  const houses = [];
  const racks = []; // {x,y,z,tilt,width,reveal}
  const units = []; // equipos de aire en azotea
  const trees = [];

  const industrialBlocks = new Set();
  const commercialBlocks = new Set();
  for (let bx = -BLOCKS; bx <= -BLOCKS + 1; bx++)
    for (let bz = -BLOCKS; bz <= -BLOCKS + 1; bz++) industrialBlocks.add(`${bx},${bz}`);
  commercialBlocks.add(`${BLOCKS - 1},${-1}`);

  const houseColors = ['#e9dfcd', '#ddd0b8', '#efe8dc', '#d8c9ad', '#e4d6c0', '#cdbb9f', '#f1ebe1', '#c9a98c'];

  // orden de "instalación" de paneles: desde el centro hacia afuera
  for (let bx = -BLOCKS; bx <= BLOCKS; bx++) {
    for (let bz = -BLOCKS; bz <= BLOCKS; bz++) {
      const key = `${bx},${bz}`;
      const cx = bx * PITCH_X;
      const cz = bz * PITCH_Z;
      if (industrialBlocks.has(key) || commercialBlocks.has(key)) continue;
      for (let lx = 0; lx < 3; lx++) {
        for (let lz = 0; lz < 2; lz++) {
          const w = LOT_W - 1.2 - rand() * 1.5;
          const d = LOT_D - 2.5 - rand() * 2;
          const h = rand() < 0.35 ? 6.2 + rand() * 1.2 : 3.4 + rand() * 0.8;
          const x = cx - BLOCK_W / 2 + LOT_W * (lx + 0.5);
          const z = cz - BLOCK_D / 2 + LOT_D * (lz + 0.5) + (lz === 0 ? -0.6 : 0.6);
          houses.push({ x, z, w, d, h, color: houseColors[Math.floor(rand() * houseColors.length)] });
          const dist = Math.hypot(x, z);
          const hasPanels = rand() < 0.85;
          if (hasPanels) {
            // ~40% ya tienen paneles al amanecer; el resto "se instala" con el scroll
            const reveal =
              rand() < 0.4 ? -1 : clamp01(0.04 + (dist / (BLOCKS * PITCH_X * 1.5)) * 0.6 + rand() * 0.16);
            const n = rand() < 0.6 ? 2 : 1;
            for (let r = 0; r < n; r++) {
              racks.push({
                x: x + (rand() - 0.5) * (w - 5.2),
                y: h,
                z: z + (n === 2 ? (r === 0 ? -2.3 : 2.3) : (rand() - 0.5) * 2),
                tilt: 0.42,
                width: 4.4,
                depth: 2.1,
                legs: 1.1,
                reveal: reveal < 0 ? reveal : clamp01(reveal + r * 0.03),
              });
            }
          }
          if (rand() < 0.6) {
            units.push({ x: x + (rand() - 0.5) * (w - 3), y: h, z: z + (rand() < 0.5 ? -1 : 1) * (d / 2 - 1.4) });
          }
          if (rand() < 0.22) {
            trees.push({ x: x + (rand() < 0.5 ? -1 : 1) * (w / 2 + 0.4), z: z + (lz === 0 ? -d / 2 - 1 : d / 2 + 1), s: 1.6 + rand() * 1.6 });
          }
        }
      }
    }
  }

  // nave industrial (como la foto "Industrial")
  const indCx = (-BLOCKS + 0.5) * PITCH_X;
  const indCz = (-BLOCKS + 0.5) * PITCH_Z;
  const indW = PITCH_X * 2 - STREET - 2;
  const indD = PITCH_Z * 2 - STREET - 2;
  const indH = 11;
  houses.push({ x: indCx, z: indCz, w: indW, d: indD, h: indH, color: '#e7e9ec', industrial: true });
  {
    const cols = Math.floor((indW - 8) / 5.4);
    const rows = Math.floor((indD - 8) / 3.6);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (rand() < 0.1) continue; // huecos para equipos
        const x = indCx - indW / 2 + 4 + 5.4 * (i + 0.5);
        const z = indCz - indD / 2 + 4 + 3.6 * (j + 0.5);
        const reveal = clamp01(0.38 + (i / cols) * 0.18 + rand() * 0.06);
        racks.push({ x, y: indH, z, tilt: 0.17, width: 4.4, depth: 2.1, legs: 0.35, reveal });
      }
    }
    for (let k = 0; k < 10; k++)
      units.push({ x: indCx + (rand() - 0.5) * (indW - 10), y: indH, z: indCz + (rand() - 0.5) * (indD - 10), big: true });
  }

  // local comercial
  {
    const [bx, bz] = [...commercialBlocks][0].split(',').map(Number);
    const x = bx * PITCH_X;
    const z = bz * PITCH_Z;
    const w = BLOCK_W - 3;
    const d = BLOCK_D - 3;
    houses.push({ x, z, w, d, h: 7.5, color: '#2f5f9e', commercial: true });
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++)
        racks.push({
          x: x - w / 2 + 4 + i * 5.6,
          y: 7.5,
          z: z - d / 2 + 5 + j * 6.4,
          tilt: 0.3,
          width: 4.4,
          depth: 2.1,
          legs: 0.8,
          reveal: 0.26 + i * 0.01,
        });
  }

  /* casas: una sola malla instanciada */
  const facade = facadeTexture();
  const roofMat = new THREE.MeshStandardMaterial({ color: '#d9d5cd', roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.95 });
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  houseGeo.translate(0, 0.5, 0);
  const homes = houses.filter((hs) => !hs.industrial && !hs.commercial);
  const houseMesh = new THREE.InstancedMesh(
    houseGeo,
    [wallMat, wallMat, roofMat, roofMat, wallMat, wallMat],
    homes.length
  );
  houseMesh.castShadow = !lowPower;
  houseMesh.receiveShadow = !lowPower;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  homes.forEach((hs, i) => {
    m4.compose(v.set(hs.x, 0, hs.z), q.identity(), s.set(hs.w, hs.h, hs.d));
    houseMesh.setMatrixAt(i, m4);
    houseMesh.setColorAt(i, col.set(hs.color));
  });
  scene.add(houseMesh);

  // nave industrial y local comercial: volúmenes lisos con franja de fachada
  houses
    .filter((hs) => hs.industrial || hs.commercial)
    .forEach((hs) => {
      const body = new THREE.MeshStandardMaterial({ color: hs.color, roughness: 0.8 });
      const b = new THREE.Mesh(houseGeo, [body, body, roofMat, roofMat, body, body]);
      b.scale.set(hs.w, hs.h, hs.d);
      b.position.set(hs.x, 0, hs.z);
      b.castShadow = b.receiveShadow = !lowPower;
      scene.add(b);
      // franja de cristal / accesos en la fachada sur
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#1f2a33', roughness: 0.2, metalness: 0.6 })
      );
      band.scale.set(hs.w * 0.86, hs.h * 0.32, 0.3);
      band.position.set(hs.x, hs.h * 0.2, hs.z + hs.d / 2 + 0.05);
      scene.add(band);
    });

  // pretiles: marco ligeramente más alto en la azotea
  const parapetGeo = new THREE.BoxGeometry(1, 1, 1);
  parapetGeo.translate(0, 0.5, 0);
  const parapetMat = new THREE.MeshStandardMaterial({ color: '#e2dbcf', roughness: 0.95 });
  const parapets = new THREE.InstancedMesh(parapetGeo, parapetMat, houses.length * 4);
  let pi = 0;
  houses.forEach((hs) => {
    const t = 0.25;
    const ph = hs.industrial ? 0.6 : 0.5;
    const parts = [
      [hs.x, hs.z - hs.d / 2 + t / 2, hs.w, t],
      [hs.x, hs.z + hs.d / 2 - t / 2, hs.w, t],
      [hs.x - hs.w / 2 + t / 2, hs.z, t, hs.d],
      [hs.x + hs.w / 2 - t / 2, hs.z, t, hs.d],
    ];
    parts.forEach(([x, z, w, d]) => {
      m4.compose(v.set(x, hs.h, z), q.identity(), s.set(w, ph, d));
      parapets.setMatrixAt(pi++, m4);
    });
  });
  parapets.castShadow = !lowPower;
  scene.add(parapets);

  /* paneles: material del frente con textura de celdas y reflejos */
  const panelTex = panelTexture(maxAniso);
  const panelFront = new THREE.MeshPhysicalMaterial({
    map: panelTex,
    roughness: 0.18,
    metalness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
  });
  const panelFrame = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.4, metalness: 0.8 });
  const panelGeo = new THREE.BoxGeometry(1, 1, 1);
  const panelMesh = new THREE.InstancedMesh(
    panelGeo,
    [panelFrame, panelFrame, panelFront, panelFrame, panelFrame, panelFrame],
    racks.length
  );
  panelMesh.castShadow = !lowPower;
  panelMesh.receiveShadow = false;
  scene.add(panelMesh);

  const legGeo = new THREE.BoxGeometry(1, 1, 1);
  legGeo.translate(0, 0.5, 0);
  const legMesh = new THREE.InstancedMesh(legGeo, panelFrame, racks.length * 2);
  legMesh.castShadow = false;
  scene.add(legMesh);

  // valores fijos de cada rack (matriz se recalcula según el "reveal")
  const rackQuat = racks.map((r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt, 0, 0)));
  let lastRevealP = -1;
  function updateRacks(p) {
    if (Math.abs(p - lastRevealP) < 0.0008) return;
    lastRevealP = p;
    racks.forEach((r, i) => {
      const k = smooth(r.reveal, r.reveal + 0.05, p);
      const ks = k < 0.001 ? 0.0001 : k;
      // el panel "cae" sobre su estructura al instalarse
      const lift = (1 - k) * 4;
      const cy = r.y + r.legs * 0.5 + 0.5 + Math.sin(r.tilt) * r.depth * 0.5 + lift;
      m4.compose(v.set(r.x, cy, r.z), rackQuat[i], s.set(r.width * ks, 0.07, r.depth * ks));
      panelMesh.setMatrixAt(i, m4);
      const legH = (r.legs * 0.5 + Math.sin(r.tilt) * r.depth * 0.95) * ks;
      m4.compose(v.set(r.x - r.width / 2 + 0.2, r.y, r.z - Math.cos(r.tilt) * r.depth * 0.45), q.identity(), s.set(0.09, legH + 0.5, 0.09));
      legMesh.setMatrixAt(i * 2, m4);
      m4.compose(v.set(r.x + r.width / 2 - 0.2, r.y, r.z - Math.cos(r.tilt) * r.depth * 0.45), q.identity(), s.set(0.09, legH + 0.5, 0.09));
      legMesh.setMatrixAt(i * 2 + 1, m4);
    });
    panelMesh.instanceMatrix.needsUpdate = true;
    legMesh.instanceMatrix.needsUpdate = true;
  }

  /* equipos de aire acondicionado en azoteas */
  const unitMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.6, metalness: 0.4 }),
    units.length
  );
  units.forEach((u, i) => {
    const sz = u.big ? 2.6 : 1.3;
    m4.compose(v.set(u.x, u.y, u.z), q.identity(), s.set(sz, sz * 0.75, sz));
    unitMesh.setMatrixAt(i, m4);
  });
  unitMesh.castShadow = !lowPower;
  scene.add(unitMesh);

  /* árboles */
  const treeMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#3f5a36', roughness: 1, flatShading: true }),
    trees.length
  );
  trees.forEach((t, i) => {
    m4.compose(v.set(t.x, t.s, t.z), q.identity(), s.set(t.s, t.s * 1.1, t.s));
    treeMesh.setMatrixAt(i, m4);
  });
  treeMesh.castShadow = !lowPower;
  scene.add(treeMesh);

  /* partículas de luz (fotones) */
  const PCOUNT = lowPower ? 500 : 1400;
  const pPos = new Float32Array(PCOUNT * 3);
  const pSeed = new Float32Array(PCOUNT);
  for (let i = 0; i < PCOUNT; i++) {
    pPos[i * 3] = (rand() - 0.5) * 360;
    pPos[i * 3 + 1] = rand() * 70 + 2;
    pPos[i * 3 + 2] = (rand() - 0.5) * 320;
    pSeed[i] = rand();
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.6 },
      uColor: { value: new THREE.Color('#ffc46b') },
      uPixel: { value: renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPixel;
      varying float vA;
      void main(){
        vec3 p = position;
        p.y += mod(uTime * (0.6 + aSeed) * 1.5 + aSeed * 70.0, 70.0) - 10.0;
        p.x += sin(uTime * 0.3 + aSeed * 12.0) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (2.0 + aSeed * 3.5) * uPixel * (90.0 / -mv.z);
        vA = 0.35 + 0.65 * fract(aSeed * 7.0 + uTime * 0.2);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * vA * uOpacity);
      }`,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  scene.add(particles);

  /* ----- post-procesado (bloom del sol y reflejos) ----- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55,
    0.5,
    0.93
  );
  if (lowPower) bloom.resolution.set(window.innerWidth / 2, window.innerHeight / 2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ----- recorrido de cámara ----- */
  const K = (p, pos, tgt) => ({ p, pos: new THREE.Vector3(...pos), tgt: new THREE.Vector3(...tgt) });
  const R = BLOCKS / 3; // escala del recorrido según el tamaño de la ciudad
  const keys = [
    K(0.0, [-24 * R, 15, 72 * R], [90, 3, 28 * R]),
    K(0.1, [-6 * R, 30, 66 * R], [60 * R, 0, 0]),
    K(0.2, [26 * R, 14, 34 * R], [6 * R, 4, -6 * R]),
    K(0.32, [85 * R, 55, 75 * R], [0, 0, -10]),
    K(0.45, [72 * R, 26, 4 * R], [-10, 6, -50 * R]),
    K(0.56, [-30 * R, 62, 8 * R], [indCx, 4, indCz]),
    K(0.68, [-95 * R, 42, -10 * R], [indCx * 0.4, 6, indCz * 0.2]),
    K(0.8, [-40 * R, 22, 52 * R], [20 * R, 4, -10 * R]),
    K(0.9, [40 * R, 32, 115 * R], [-40 * R, 4, -10 * R]),
    K(1.0, [55 * R, 30, 80 * R], [-220, 8, 70]),
  ];
  const posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.tgt), false, 'centripetal');
  // convierte progreso de scroll a parámetro de curva respetando los "p" de cada clave
  function curveT(p) {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (p <= b.p) {
        const f = (p - a.p) / (b.p - a.p);
        // suavizado por segmento para que cada sección "asiente" la cámara
        const e = f * f * (3 - 2 * f);
        return (i + lerp(f, e, 0.55)) / (keys.length - 1);
      }
    }
    return 1;
  }

  /* ----- estado ----- */
  let targetP = 0;
  let p = 0;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  const camPos = new THREE.Vector3();
  const camTgt = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmpCol = new THREE.Color();
  const clock = new THREE.Clock();
  let running = true;

  function sunDirection(t, out) {
    // t: 0 amanecer (este, +x) → 1 atardecer (oeste, -x); arco por el sur (+z)
    const a = lerp(-0.06, Math.PI + 0.04, t);
    return out.set(Math.cos(a), Math.sin(a) * 0.82, Math.sin(a) * 0.5).normalize();
  }

  function updateSky(t) {
    sunDirection(t, sunDir);
    const elev = sunDir.y;
    const day = smooth(-0.04, 0.5, elev);
    const low = 1 - smooth(0.0, 0.32, elev);
    const night = 1 - smooth(-0.08, 0.08, elev);

    skyUniforms.uTop.value.copy(SKY.dawnTop).lerp(SKY.dayTop, day).lerp(SKY.nightTop, night * 0.6);
    skyUniforms.uHorizon.value.copy(SKY.dawnHorizon).lerp(SKY.dayHorizon, day);
    skyUniforms.uGround.value.copy(SKY.dawnGround).lerp(SKY.dayGround, day);
    skyUniforms.uSunColor.value.copy(SKY.sunLow).lerp(SKY.sunHigh, day);
    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uGlow.value = 0.6 + low * 1.4;
    skyUniforms.uStars.value = night * night * 0.8;

    // niebla = color del horizonte (mezcla con algo de cielo)
    tmpCol.copy(skyUniforms.uHorizon.value).lerp(skyUniforms.uTop.value, 0.25);
    scene.fog.color.copy(tmpCol);
    scene.fog.density = lerp(0.0019, 0.0012, day);

    sun.color.copy(SKY.sunLow).lerp(SKY.sunHigh, day);
    sun.intensity = lerp(1.2, 3.2, smooth(-0.02, 0.35, elev));
    sun.position.copy(sunDir).multiplyScalar(400);
    sun.target.position.set(0, 0, 0);
    hemi.intensity = lerp(0.35, 0.9, day);
    hemi.color.copy(skyUniforms.uTop.value).lerp(new THREE.Color('#ffffff'), 0.5);

    renderer.toneMappingExposure = lerp(0.88, 0.98, day);
    pMat.uniforms.uOpacity.value = lerp(0.85, 0.4, day);
    pMat.uniforms.uColor.value.copy(SKY.sunLow).lerp(new THREE.Color('#fff1c8'), day);
    bloom.strength = lerp(0.6, 0.22, day);

    if (Math.abs(t - lastEnvT) > 0.012) {
      lastEnvT = t;
      const rt = pmrem.fromScene(envScene, 0, 1, 2000);
      scene.environment = rt.texture;
      if (envRT) envRT.dispose();
      envRT = rt;
    }
  }

  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    p += (targetP - p) * Math.min(1, dt * 3.2);
    pointerSmooth.lerp(pointer, Math.min(1, dt * 2.5));

    const ct = curveT(p);
    posCurve.getPoint(ct, camPos);
    tgtCurve.getPoint(ct, camTgt);
    // paralaje con el puntero
    camPos.x += pointerSmooth.x * 4;
    camPos.y += -pointerSmooth.y * 2.5;
    camera.position.copy(camPos);
    camera.lookAt(camTgt);

    updateSky(0.03 + p * 0.96);
    updateRacks(p);
    pMat.uniforms.uTime.value += dt;
    particles.position.set(camTgt.x * 0.6, 0, camTgt.z * 0.6);

    composer.render(dt);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    // en pantallas verticales abrimos el campo de visión
    camera.fov = w / h < 0.8 ? 62 : 48;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    if (lowPower) bloom.resolution.set(w / 2, h / 2);
    pMat.uniforms.uPixel.value = renderer.getPixelRatio();
  }
  window.addEventListener('resize', resize);
  resize();

  // primer cuadro sincrónico (para el loader)
  updateSky(0.03);
  updateRacks(0);
  renderer.setAnimationLoop(frame);

  return {
    setProgress(v, immediate = false) {
      targetP = clamp01(v);
      if (immediate) p = targetP;
    },
    setPointer(x, y) {
      pointer.set(x, y);
    },
    /** hora del día (0..1) actual, útil para el HUD */
    get dayT() {
      return 0.03 + p * 0.96;
    },
    pause() {
      running = false;
    },
    resume() {
      if (!running) {
        running = true;
        clock.getDelta();
      }
    },
    resize,
  };
}
