// One small scene per project, built only from facts in projects.json. Each scene is lit by one low key
// light that casts real shadows; the glyph pass turns light into the portrait's ramp. Plain surfaces
// write their light into the red channel, the one accent element per scene into green (it becomes cyan).
// Scroll drives every movement (p: arriving, 0 -> 1 settled; q: leaving), so nothing plays on its own.
import {
  Scene, PerspectiveCamera, Mesh, BoxGeometry, PlaneGeometry, TorusGeometry, SphereGeometry,
  MeshLambertMaterial, DirectionalLight, AmbientLight, Group, Vector3, Color, Fog, Object3D, BufferAttribute,
} from 'three';

export interface Label { text: string; accent?: boolean; below?: boolean; at: () => Vector3; show?: () => number }
export interface Pointer { x: number; y: number; k: number }
export interface Work {
  scene: Scene;
  camera: PerspectiveCamera;
  update: (p: number, q: number, t: number, pointer: Pointer | null) => void;
  labels?: Label[];
  live?: (p: number, q: number) => boolean;
  /** the floor's pool of light: centre x, y and radii, as fractions of the figure */
  pool?: [number, number, number, number];
  dispose: () => void;
}

// ---- motion helpers -------------------------------------------------------------------------------------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const out3 = (t: number) => 1 - (1 - t) ** 3;
// ease-out with a small overshoot, like a pin settling (1.2 keeps the overshoot under 10%)
const back = (t: number, s = 1.2) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2);

// ---- shared building blocks -------------------------------------------------------------------------------
const BOX = new BoxGeometry(1, 1, 1);
const BOX_UP = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // grows upwards from y = 0 when scaled
const mats = new Map<string, MeshLambertMaterial>();
/** Lambert material: plain surfaces put their light in red, the accent in green, the floor in blue. */
function mat(albedo: number, accent = false, floor = false): MeshLambertMaterial {
  const key = `${albedo}|${accent}|${floor}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color: floor ? new Color(0, 0, albedo) : accent ? new Color(0, albedo, 0) : new Color(albedo, 0, 0) });
    mats.set(key, m);
  }
  return m;
}
function box(w: number, h: number, d: number, m: MeshLambertMaterial, up = false): Mesh {
  const b = new Mesh(up ? BOX_UP : BOX, m);
  b.scale.set(w, h, d);
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}

interface Rig { scene: Scene; camera: PerspectiveCamera; key: DirectionalLight; base: Vector3; eye: Vector3; look: Vector3 }
function rig(eye: [number, number, number], look: [number, number, number], light: [number, number, number], fogFar = 7): Rig {
  const scene = new Scene();
  scene.fog = new Fog(0x000000, fogFar * 0.55, fogFar);
  const camera = new PerspectiveCamera(30, 1.4, 0.1, 30);
  const key = new DirectionalLight(0xffffff, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2.4; key.shadow.camera.right = 2.4;
  key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -2.4;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 12;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 2;
  scene.add(key, key.target, new AmbientLight(0xffffff, 0.32));
  const floor = new Mesh(new PlaneGeometry(14, 14), mat(0.3, false, true));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  return { scene, camera, key, base: new Vector3(...light).normalize(), eye: new Vector3(...eye), look: new Vector3(...look) };
}

/** Camera: arrives from a slightly lower, turned position, settles, then keeps turning a little as the row leaves. */
const tmp = new Vector3();
function place(r: Rig, p: number, q: number, pointer: Pointer | null): void {
  const a = -0.32 * (1 - out3(p)) + 0.28 * q;
  const lift = -0.18 * (1 - out3(p)) + 0.22 * q;
  tmp.copy(r.eye).sub(r.look);
  const c = Math.cos(a), s = Math.sin(a);
  r.camera.position.set(r.look.x + tmp.x * c - tmp.z * s, r.look.y + tmp.y + lift, r.look.z + tmp.x * s + tmp.z * c);
  r.camera.lookAt(r.look);
  // the key light follows the pointer over the figure, the way the portrait's light does
  const k = pointer?.k ?? 0;
  const lx = r.base.x + k * ((pointer?.x ?? 0) * 1.1 - r.base.x);
  const lz = r.base.z + k * ((pointer?.y ?? 0) * 1.1 - r.base.z);
  r.key.position.set(lx * 6, r.base.y * 6, lz * 6).add(r.look);
  r.key.target.position.copy(r.look);
}

function dispose(scene: Scene): void {
  scene.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (m.geometry && m.geometry !== BOX && m.geometry !== BOX_UP) m.geometry.dispose();
  });
}

// ---- Messy Mashup: the log-mel spectrogram the model reads, as terrain -------------------------------------
async function messy(): Promise<Work> {
  const img = new Image();
  img.src = '/work3d/mel-milenberg-joys.png';
  await img.decode();
  // 192 frames x 48 mel bands (high bands on top), averaged down to one vertex per 0.125 s and per 2 bands:
  // at the figure's cell size, finer detail only turns into noise
  const W = 96, H = 24;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const val = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) val[i] = px[i * 4]! / 255;

  // seen from about 40 degrees up, so time (left to right) and pitch (front to back) both stay readable;
  // a low light from the left makes every beat cast a shadow on the one after it
  const r = rig([-0.35, 2.05, 2.55], [0.05, 0.0, 0.05], [-0.62, 0.75, -0.2], 8);
  const SX = 2.05, SZ = 1.5;
  const geo = new PlaneGeometry(SX, SZ, W - 1, H - 1);
  geo.rotateX(-Math.PI / 2); // row 0 (high bands) ends up at the back
  const pos = geo.getAttribute('position') as BufferAttribute;
  // brightness follows the energy as well as the height, like the portrait's tone map;
  // the rising front of the terrain is the playhead, drawn in the accent (green channel)
  const tone = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) tone[i] = 0.26 + 0.74 * Math.pow(val[i]!, 1.1);
  const col = new Float32Array(W * H * 3);
  const colAttr = new BufferAttribute(col, 3);
  geo.setAttribute('color', colAttr);
  const terrainMat = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  const terrain = new Mesh(geo, terrainMat);
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  r.scene.add(terrain);

  let lastP = -1;
  return {
    scene: r.scene, camera: r.camera,
    labels: [
      { text: '0 s', below: true, at: () => new Vector3(-SX / 2, 0, SZ / 2 + 0.04) },
      { text: '12 s', below: true, at: () => new Vector3(SX / 2, 0, SZ / 2 + 0.04), show: () => seg(lastP, 0.85, 1) },
    ],
    update(p, q, _t, pointer) {
      place(r, p, q, pointer);
      if (Math.abs(p - lastP) < 1e-4) return;
      lastP = p;
      // the clip plays from 0 to 12 s as you scroll: the spectrogram rises behind a cyan front
      const f = -0.08 + p * 1.16;
      const glow = 1 - seg(p, 0.9, 1);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i, xn = i / (W - 1);
        const rise = back(seg(f - xn, 0, 0.16), 1.0);
        pos.setY(k, 0.012 + Math.pow(val[k]!, 1.6) * 0.5 * rise);
        const a = glow * Math.exp(-Math.pow((f - xn - 0.03) / 0.05, 2)) * (rise > 0.02 ? 1 : 0);
        col[k * 3] = tone[k]! * (1 - a);
        col[k * 3 + 1] = 1.1 * a;
      }
      pos.needsUpdate = true;
      colAttr.needsUpdate = true;
      geo.computeVertexNormals();
    },
    dispose: () => { terrainMat.dispose(); dispose(r.scene); },
  };
}

// ---- Comment Category Prediction: the three published scores as columns -----------------------------------
async function comments(): Promise<Work> {
  const r = rig([1.9, 1.45, 2.7], [0.02, 0.4, 0.05], [-0.5, 0.62, 0.35]);
  const data = [
    { name: 'Voting ensemble', score: 0.8295, best: true },
    { name: 'MLP', score: 0.746 },
    { name: 'LightGBM', score: 0.7386 },
  ];
  const cols = data.map((d, i) => {
    const m = box(0.36, 1, 0.36, mat(d.best ? 1 : 0.82, !!d.best), true);
    m.position.set(-0.6 + i * 0.6, 0, 0);
    r.scene.add(m);
    return m;
  });
  const grow = (p: number, i: number) => back(seg(p, 0.08 + i * 0.13, 0.6 + i * 0.13), 1.4);
  let P = 0;
  return {
    scene: r.scene, camera: r.camera,
    labels: data.flatMap((d, i) => [
      { text: d.score.toFixed(4), accent: !!d.best, at: () => new Vector3(-0.6 + i * 0.6, cols[i]!.scale.y + 0.08, 0), show: () => seg(grow(P, i), 0.75, 1) },
      { text: d.name, below: true, at: () => new Vector3(-0.6 + i * 0.6, 0, 0.5), show: () => seg(P, 0.05, 0.3) },
    ]),
    update(p, q, _t, pointer) {
      P = p;
      place(r, p, q, pointer);
      cols.forEach((m, i) => { m.scale.y = Math.max(0.001, data[i]!.score * 1.25 * grow(p, i)); });
    },
    dispose: () => dispose(r.scene),
  };
}

// ---- LLM Code Deployment Agent: a brief becomes a page, the page goes up, the live URL is polled ----------
async function deployer(): Promise<Work> {
  const r = rig([-1.5, 1.2, 2.85], [0.0, 0.36, 0.05], [-0.62, 0.58, 0.4]);
  const repo = box(1.6, 0.08, 0.6, mat(0.55), true);
  repo.position.set(0.15, 0, -0.1);
  r.scene.add(repo);

  // the brief: a sheet lying in front, its lines typed in
  const brief = new Group();
  brief.position.set(-0.72, 0.004, 0.52);
  brief.rotation.y = 0.32;
  brief.add(box(0.6, 0.008, 0.42, mat(0.42)));
  const briefLines = [0.46, 0.4, 0.3].map((w, i) => {
    const l = box(w, 0.02, 0.07, mat(i ? 0.75 : 1));
    l.position.set(-0.24 + w / 2, 0.01, -0.11 + i * 0.12);
    brief.add(l);
    return { l, w };
  });
  r.scene.add(brief);

  // the page: hinged on the repo's back edge, it lies flat, then stands up
  const hinge = new Group();
  hinge.position.set(0.15, 0.08, -0.32);
  const plate = box(1.3, 0.86, 0.035, mat(0.36));
  plate.position.set(0, 0.43, 0);
  hinge.add(plate);
  const blocks = [
    { w: 1.2, h: 0.06, x: 0, y: 0.79 },                  // nav bar
    { w: 0.78, h: 0.1, x: -0.19, y: 0.6 },               // headline
    { w: 0.52, h: 0.045, x: -0.32, y: 0.47 },            // sub line
    { w: 0.36, h: 0.26, x: -0.41, y: 0.2 },              // three cards
    { w: 0.36, h: 0.26, x: 0, y: 0.2 },
    { w: 0.36, h: 0.26, x: 0.41, y: 0.2 },
  ].map((b) => {
    const m = box(b.w, b.h, 0.05, mat(1));
    m.position.set(b.x, b.y, 0.04);
    hinge.add(m);
    return m;
  });
  const dot = new Mesh(new SphereGeometry(0.035, 16, 12), mat(1, true));
  dot.position.set(-0.55, 0.79, 0.09);
  hinge.add(dot);
  r.scene.add(hinge);

  // polling: two rings go out from the repo while the agent waits for the live URL
  const ringGeo = new TorusGeometry(1, 0.012, 6, 96);
  const rings = [0, 1].map(() => {
    const m = new Mesh(ringGeo, mat(1, true));
    m.rotation.x = Math.PI / 2;
    m.position.set(0.15, 0.02, -0.1);
    r.scene.add(m);
    return m;
  });

  return {
    scene: r.scene, camera: r.camera,
    update(p, q, _t, pointer) {
      place(r, p, q, pointer);
      briefLines.forEach(({ l, w }, i) => {
        const k = out3(seg(p, 0.02 + i * 0.06, 0.16 + i * 0.06));
        l.scale.x = Math.max(0.001, w * k);
        l.position.x = -0.24 + (w * k) / 2;
      });
      hinge.rotation.x = -Math.PI / 2 * (1 - back(seg(p, 0.22, 0.6), 1.1));
      blocks.forEach((m, i) => { m.scale.z = Math.max(0.001, 0.05 * back(seg(p, 0.42 + i * 0.045, 0.62 + i * 0.045), 1.6)); });
      rings.forEach((m, i) => {
        const k = seg(p, 0.66 + i * 0.1, 0.92 + i * 0.06);
        m.visible = k > 0 && k < 1;
        const s = 0.35 + 0.75 * out3(k);
        m.scale.set(s, s, Math.max(0.2, 1 - k));
      });
      const d = back(seg(p, 0.86, 1), 2.2);
      dot.scale.setScalar(Math.max(0.001, d));
    },
    dispose: () => { ringGeo.dispose(); dispose(r.scene); },
  };
}

// ---- MedSyncPro: a week of slots; a second booking for a taken slot is refused --------------------------
async function medsync(): Promise<Work> {
  const r = rig([0.3, 2.25, 2.3], [0.0, 0.05, 0.05], [-0.45, 0.66, -0.25]);
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], SLOTS = 5, DX = 0.36, DZ = 0.22;
  const cx = (i: number) => (i - (DAYS.length - 1) / 2) * DX, cz = (j: number) => (j - (SLOTS - 1) / 2) * DZ;
  for (let i = 0; i < DAYS.length; i++) for (let j = 0; j < SLOTS; j++) {
    const t = box(0.31, 0.02, 0.18, mat(0.45), true);
    t.position.set(cx(i), 0, cz(j));
    r.scene.add(t);
  }
  const taken: [number, number][] = [[0, 0], [0, 3], [1, 1], [1, 4], [2, 2], [3, 0], [3, 3], [4, 1], [4, 2], [2, 4]];
  const appts = taken.map(([i, j]) => {
    const b = box(0.27, 0.11, 0.14, mat(0.95), true);
    b.position.set(cx(i), 0.02, cz(j));
    r.scene.add(b);
    return b;
  });
  const asked: [number, number] = [2, 2], free: [number, number] = [2, 1];
  const mine = box(0.27, 0.11, 0.14, mat(1, true), true);
  r.scene.add(mine);

  return {
    scene: r.scene, camera: r.camera,
    labels: DAYS.map((d, i) => ({ text: d, at: () => new Vector3(cx(i), 0, cz(0) - 0.2) })),
    update(p, q, _t, pointer) {
      place(r, p, q, pointer);
      appts.forEach((b, n) => {
        const k = seg(p, 0.02 + n * 0.035, 0.22 + n * 0.035);
        b.position.y = 0.02 + 0.7 * (1 - back(k, 1.0));
        b.visible = k > 0;
      });
      // the new booking comes down over a taken slot, stops above it, is refused, and moves to a free one
      const down = out3(seg(p, 0.42, 0.6));
      const shake = seg(p, 0.6, 0.72);
      const slide = out3(seg(p, 0.72, 0.86));
      const land = back(seg(p, 0.84, 1), 1.0);
      const x = cx(asked[0]) + (cx(free[0]) - cx(asked[0])) * slide + Math.sin(shake * Math.PI * 6) * 0.025 * (1 - shake);
      const z = cz(asked[1]) + (cz(free[1]) - cz(asked[1])) * slide;
      mine.position.set(x, 0.95 - 0.7 * down - 0.23 * land, z);
      mine.visible = p > 0.42;
    },
    dispose: () => dispose(r.scene),
  };
}

// ---- Interview Intelligence AI: a resume and a job description in, one report out -----------------------
async function interview(): Promise<Work> {
  const r = rig([0.15, 2.3, 2.05], [-0.02, 0.0, 0.06], [-0.5, 0.7, -0.3]);
  // sheets carry a few bold lines: anything thinner than about three cells turns into noise
  const sheet = (w: number, d: number, lines: number[]) => {
    const g = new Group();
    g.add(box(w, 0.01, d, mat(0.3), true));
    lines.forEach((lw, i) => {
      const l = box(lw * w * 0.78, 0.022, i === 0 ? 0.09 : 0.06, mat(i === 0 ? 1 : 0.72), true);
      l.position.set(-w * 0.39 + (lw * w * 0.78) / 2, 0.01, -d / 2 + 0.12 + i * 0.14 + (i ? 0.02 : 0));
      g.add(l);
    });
    return g;
  };
  const resume = sheet(0.56, 0.78, [0.6, 0.95, 0.8, 0.9, 0.55]);
  const jd = sheet(0.56, 0.78, [0.75, 0.9, 0.95, 0.6, 0.8]);
  r.scene.add(resume, jd);

  // the report: answers, skill gaps ranked by severity (standing bars), and a prep plan (checklist)
  const report = new Group();
  report.position.set(0.42, 0, 0.02);
  report.add(box(0.9, 0.01, 1.08, mat(0.3), true));
  const answers = [0.95, 0.8].map((w, i) => {
    const l = box(w * 0.74, 0.022, i === 0 ? 0.09 : 0.06, mat(i === 0 ? 1 : 0.72), true);
    l.position.set(-0.37 + (w * 0.74) / 2, 0.01, -0.42 + i * 0.14);
    report.add(l);
    return { l, w: w * 0.74 };
  });
  const gaps = [0.36, 0.25, 0.16, 0.09].map((h, i) => {
    const b = box(0.12, 1, 0.12, mat(i === 0 ? 1 : 0.85, i === 0), true);
    b.position.set(-0.3 + i * 0.19, 0.01, -0.03);
    report.add(b);
    return { b, h };
  });
  const plan = [0, 1].map((i) => {
    const tick = box(0.07, 0.05, 0.07, mat(1), true);
    tick.position.set(-0.33, 0.01, 0.25 + i * 0.15);
    const l = box(0.48, 0.022, 0.06, mat(0.72), true);
    l.position.set(0.02, 0.01, 0.25 + i * 0.15);
    report.add(tick, l);
    return { tick, l };
  });
  r.scene.add(report);
  let P = 0;

  return {
    scene: r.scene, camera: r.camera,
    pool: [0.5, 0.5, 0.56, 0.5],
    labels: [
      { text: 'Resume + job description', at: () => new Vector3(-0.66, 0, -0.5) },
      { text: 'Report', at: () => new Vector3(0.42, 0, -0.58), show: () => seg(P, 0.35, 0.5) },
    ],
    update(p, q, _t, pointer) {
      P = p;
      place(r, p, q, pointer);
      // the two inputs slide in from the left and land as an offset stack
      const a = out3(seg(p, 0.0, 0.32)), b = out3(seg(p, 0.08, 0.4));
      resume.position.set(-0.74 - 1.6 * (1 - a), 0, -0.04);
      resume.rotation.y = 0.1 + 0.5 * (1 - a);
      jd.position.set(-0.6 - 1.6 * (1 - b), 0.035, 0.1);
      jd.rotation.y = -0.07 + 0.5 * (1 - b);
      // the report is written section by section
      report.scale.setScalar(0.001 + 0.999 * out3(seg(p, 0.3, 0.46)));
      answers.forEach(({ l, w }, i) => {
        const k = out3(seg(p, 0.42 + i * 0.05, 0.56 + i * 0.05));
        l.scale.x = Math.max(0.001, w * k);
        l.position.x = -0.37 + (w * k) / 2;
      });
      gaps.forEach(({ b, h }, i) => { b.scale.y = Math.max(0.001, h * back(seg(p, 0.58 + i * 0.05, 0.8 + i * 0.05), 1.5)); });
      plan.forEach(({ tick, l }, i) => {
        const k = seg(p, 0.8 + i * 0.06, 0.94 + i * 0.04);
        tick.scale.y = Math.max(0.001, 0.05 * back(k, 2));
        l.scale.x = Math.max(0.001, 0.48 * out3(k));
      });
    },
    dispose: () => dispose(r.scene),
  };
}

export const SCENES: Record<string, () => Promise<Work>> = {
  'interview-intelligence-ai': interview,
  'messy-mashup': messy,
  'llm-code-deployment-agent': deployer,
  medsyncpro: medsync,
  'comment-category-prediction': comments,
};
