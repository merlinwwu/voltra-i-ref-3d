import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const SUB_CN = { HSG: '壳体', MOT: '电机', DRUM: '卷筒', LW: '排线', EXIT: '出线口', CAB: '绳与绳头', PWR: '电源', ELEC: '电子', DOCK: '对接' };
const SHELL_IDS = ['HSG-MAIN-01-UPR', 'HSG-MAIN-01-LWR', 'HSG-END-L-01', 'HSG-END-R-01', 'MOT-HSG-01'];
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.setClearColor(0xeef1f4);
view.appendChild(renderer.domElement);
const labelR = new CSS2DRenderer();
labelR.domElement.style.position = 'absolute'; labelR.domElement.style.top = '0'; labelR.domElement.style.pointerEvents = 'none';
view.appendChild(labelR.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9099, 1.6));
const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(300, 500, 600); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.6); dl2.position.set(-400, -200, -300); scene.add(dl2);
const grid = new THREE.GridHelper(800, 40, 0xc0c6cc, 0xd8dde2); grid.position.y = -70; scene.add(grid);
const axes = new THREE.AxesHelper(40); axes.position.set(-200, -69, -60); scene.add(axes);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
let META = null; const parts = {}; const groups = {};
const dimGroup = new THREE.Group(); const loadGroup = new THREE.Group(); const measGroup = new THREE.Group();
scene.add(dimGroup, loadGroup, measGroup); dimGroup.visible = false; loadGroup.visible = false;
let selected = null;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); labelR.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function setCam(pos, tgt) { camera.position.set(...pos); controls.target.set(...tgt); controls.update(); }
const CAM_DEFAULT = [[260, 190, 430], [0, 0, 0]];

Promise.all([fetch('models/meta.json').then(r => r.json()), new GLTFLoader().loadAsync('models/voltra-i-ref.glb')]).then(([meta, gltf]) => {
  META = meta;
  const byId = Object.fromEntries(meta.parts.map(p => [p.id, p]));
  gltf.scene.traverse(o => {
    if (o.isMesh) {
      const id = o.name in byId ? o.name : (o.parent && o.parent.name in byId ? o.parent.name : o.name);
      const m = byId[id]; if (!m) return;
      o.material = o.material.clone();
      o.material.side = THREE.DoubleSide;
      o.material.clippingPlanes = [clipPlane];
      o.material.clipShadows = true;
      o.userData.id = id;
      parts[id] = { mesh: o, meta: m, base: o.position.clone(), baseColor: o.material.color.clone() };
      (groups[m.sub] ||= []).push(id);
    }
  });
  scene.add(gltf.scene);
  buildUI(); buildDims(); buildLoad(); resize();
  setCam(...CAM_DEFAULT);
  applyClip();
  const q = new URLSearchParams(location.search).get('view'); if (q) setView(q);
  window.__ready = true;
});

// ---------- UI ----------
function buildUI() {
  const subs = document.getElementById('subs');
  subs.innerHTML = '<div class="muted">按子系统显示：</div>' + Object.keys(SUB_CN).filter(k => groups[k]).map(k =>
    `<label><input type="checkbox" data-sub="${k}" checked> ${SUB_CN[k]}</label>`).join('');
  subs.querySelectorAll('input').forEach(cb => cb.onchange = () => groups[cb.dataset.sub].forEach(id => parts[id].mesh.visible = cb.checked));
  const tree = document.getElementById('tree');
  tree.innerHTML = Object.keys(SUB_CN).filter(k => groups[k]).map(k =>
    `<div class="grp">${SUB_CN[k]}（${k}）</div>` + groups[k].map(id => `<div class="it" data-id="${id}" title="${parts[id].meta.name}">${id} · ${parts[id].meta.name}</div>`).join('')).join('');
  tree.querySelectorAll('.it').forEach(el => el.onclick = () => select(el.dataset.id, true));
  const ex = document.getElementById('explode');
  ex.oninput = () => { document.getElementById('explodeV').textContent = (+ex.value).toFixed(2); applyExplode(+ex.value); };
  const so = document.getElementById('shellOp');
  so.oninput = () => { document.getElementById('shellOpV').textContent = (+so.value).toFixed(2); applyShellOp(+so.value); };
  ['clipOn', 'clipPos', 'clipFlip'].forEach(id => document.getElementById(id).oninput = applyClip);
  document.querySelectorAll('input[name=clipAx]').forEach(r => r.onchange = applyClip);
  document.getElementById('dimOn').onchange = e => dimGroup.visible = e.target.checked;
  document.getElementById('loadOn').onchange = e => loadGroup.visible = e.target.checked;
  document.getElementById('measOn').onchange = e => { measPts = []; document.getElementById('measBox').style.display = e.target.checked ? 'block' : 'none'; document.getElementById('measBox').textContent = '测量模式：依次点击两个点'; };
  document.getElementById('measClear').onclick = () => { measGroup.clear(); measPts = []; };
  document.querySelectorAll('button[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  fetch('downloads/drawings/index.json').then(r => r.json()).then(list => {
    document.getElementById('dwgList').innerHTML = '<div class="muted">自制件工程图：</div><ul>' + list.map(d =>
      `<li>${d.id} ${d.name}：<a href="downloads/drawings/${d.pdf}" target="_blank">PDF</a> · <a href="downloads/drawings/${d.dxf}" download>DXF</a></li>`).join('') + '</ul>';
  }).catch(() => {});
}
function applyExplode(f) {
  for (const id in parts) { const p = parts[id]; const e = p.meta.explode; p.mesh.position.set(p.base.x + e[0] * f, p.base.y + e[1] * f, p.base.z + e[2] * f); }
}
function applyShellOp(v) {
  SHELL_IDS.forEach(id => { const p = parts[id]; if (!p) return; p.mesh.material.transparent = v < 0.999; p.mesh.material.opacity = v; p.mesh.material.depthWrite = v > 0.6; p.mesh.visible = v > 0.01 && isSubOn(p.meta.sub); });
}
function isSubOn(sub) { const cb = document.querySelector(`input[data-sub=${sub}]`); return !cb || cb.checked; }
function applyClip() {
  const on = document.getElementById('clipOn').checked;
  const ax = document.querySelector('input[name=clipAx]:checked').value;
  const pos = +document.getElementById('clipPos').value; document.getElementById('clipPosV').textContent = pos;
  const flip = document.getElementById('clipFlip').checked ? -1 : 1;
  const n = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[ax].map(v => -v * flip);
  if (on) { clipPlane.normal.set(...n); clipPlane.constant = pos * flip; } else { clipPlane.normal.set(0, 0, -1); clipPlane.constant = 1e5; }
}
function setView(v) {
  const ex = document.getElementById('explode'), so = document.getElementById('shellOp'), co = document.getElementById('clipOn');
  if (v === 'assembled') { ex.value = 0; so.value = 1; co.checked = false; setCam(...CAM_DEFAULT); }
  if (v === 'explode') { ex.value = 1; so.value = 0.25; co.checked = false; setCam([420, 330, 760], [0, 20, 80]); }
  if (v === 'section-x') {
    ex.value = 0; so.value = 1; co.checked = true; document.getElementById('clipPos').value = -4.5;
    document.querySelector('input[name=clipAx][value=x]').checked = true; document.getElementById('clipFlip').checked = false;
    setCam([300, 110, 190], [-4.5, 0, 0]);
  }
  if (v === 'section' || v === 'section-z') {
    ex.value = 0; so.value = 1; co.checked = true; document.getElementById('clipPos').value = 0;
    document.querySelector('input[name=clipAx][value=z]').checked = true; document.getElementById('clipFlip').checked = false;
    setCam([-20, 140, 600], [0, -5, 0]);
  }
  if (v === 'reset') setCam(...CAM_DEFAULT);
  ex.oninput(); so.oninput(); applyClip();
  if (v === 'load') { document.getElementById('loadOn').checked = true; loadGroup.visible = true; }
}

// ---------- 选择 / 信息 ----------
const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let downPos = null;
renderer.domElement.addEventListener('pointerdown', e => downPos = [e.clientX, e.clientY]);
renderer.domElement.addEventListener('pointerup', e => {
  if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const objs = Object.values(parts).filter(p => p.mesh.visible).map(p => p.mesh);
  const hits = ray.intersectObjects(objs, false).filter(h => !clipActive() || clipPlane.distanceToPoint(h.point) >= -1e-6)
    .filter(h => !(h.object.material.transparent && h.object.material.opacity < 0.5));
  if (!hits.length) return;
  if (document.getElementById('measOn').checked) return addMeas(hits[0].point);
  select(hits[0].object.userData.id);
});
function clipActive() { return document.getElementById('clipOn').checked; }
function srcBadges(s) {
  return s.split(/[+；;（）()·、]/).map(t => t.trim()).filter(Boolean).map(t => {
    const k = ['官方', '照片', '专利', '假设', '推测', '视频'].find(k => t.includes(k)); return k ? `<span class="src ${k}">${t}</span>` : `<span class="muted">${t}</span>`;
  }).join(' ');
}
function select(id, focus) {
  if (selected && parts[selected]) parts[selected].mesh.material.emissive.setHex(0x000000);
  selected = id; const p = parts[id]; if (!p) return;
  p.mesh.material.emissive.setHex(0x3355aa);
  document.querySelectorAll('#tree .it').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  const m = p.meta; const b = m.bbox;
  document.getElementById('info').innerHTML = `<h2>零件信息</h2><table>
    <tr><td>ID</td><td><b>${m.id}</b></td></tr><tr><td>名称</td><td>${m.name}</td></tr>
    <tr><td>子系统</td><td>${SUB_CN[m.sub]}（${m.sub}）</td></tr><tr><td>上级装配</td><td>${m.assy}</td></tr>
    <tr><td>数量</td><td>${m.qty}</td></tr><tr><td>关键尺寸</td><td>${m.dims}</td></tr>
    <tr><td>包络</td><td>${(b[3] - b[0]).toFixed(1)} × ${(b[4] - b[1]).toFixed(1)} × ${(b[5] - b[2]).toFixed(1)} mm</td></tr>
    <tr><td>材料建议</td><td>${m.mat}</td></tr><tr><td>自制/外购</td><td>${m.make}</td></tr>
    ${m.std ? `<tr><td>标准</td><td>${m.std}</td></tr>` : ''}
    <tr><td>来源等级</td><td>${srcBadges(m.src)}</td></tr>
    <tr><td>估算质量</td><td>${m.mass_g} g <span class="muted">（${m.mass_src}）</span></td></tr>
    <tr><td>下载</td><td><a href="${m.step}" download>STEP</a> · <a href="${m.stl}" download>STL</a></td></tr></table>
    <p class="muted">独立参考设计取值，非原机实测。</p>`;
  if (focus) { const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2); controls.target.copy(c); controls.update(); }
}

// ---------- 测量 ----------
let measPts = [];
function addMeas(pt) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(1.6), new THREE.MeshBasicMaterial({ color: 0x1565c0, depthTest: false }));
  s.position.copy(pt); s.renderOrder = 10; measGroup.add(s); measPts.push(pt.clone());
  if (measPts.length === 2) {
    const [a, b] = measPts; const d = a.distanceTo(b);
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const ln = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1565c0, depthTest: false })); ln.renderOrder = 10; measGroup.add(ln);
    const txt = `${d.toFixed(2)} mm（ΔX ${(b.x - a.x).toFixed(1)}，ΔY ${(b.y - a.y).toFixed(1)}，ΔZ ${(b.z - a.z).toFixed(1)}）`;
    measGroup.add(label(txt, a.clone().add(b).multiplyScalar(0.5), 'meas'));
    document.getElementById('measBox').textContent = '距离 ' + txt; measPts = [];
  } else document.getElementById('measBox').textContent = '已选第 1 点，请点第 2 点';
}

// ---------- 标注 ----------
function label(text, pos, cls = '') { const d = document.createElement('div'); d.className = 'lbl ' + cls; d.textContent = text; const o = new CSS2DObject(d); o.position.copy(pos); return o; }
function dimLine(a, b, text, color = 0x37474f) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]), new THREE.LineBasicMaterial({ color, depthTest: false }));
  ln.renderOrder = 5; dimGroup.add(ln);
  const dir = B.clone().sub(A).normalize();
  [A, B].forEach((P, i) => { const c = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    c.position.copy(P); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), i ? dir : dir.clone().negate()); c.translateY(-3); c.renderOrder = 5; dimGroup.add(c); });
  dimGroup.add(label(text, A.clone().add(B).multiplyScalar(0.5)));
}
function buildDims() {
  const d = META.derived, p = META.params;
  dimLine([-161.5, -82, 50], [161.5, -82, 50], '长 323（官方）');
  dimLine([175, -69.5, 50], [175, 69.5, 50], '高 139（官方）');
  dimLine([175, -75, -50], [175, -75, 50], '深 100（官方）');
  dimLine([d.X_EXIT + 2, 0, 0], [d.X_EXIT + 2, 20, 0], 'r_eff 20（假设）', 0xc62828);
  dimLine([d.XS0, 0, 0], [d.XS0, 47.37, 0], 'R47.37 定子 Ø94.742（官方）', 0xb87333);
  dimLine([d.X_BRG03, -32, 0], [d.X_BRG01, -32, 0], `BRG-03 ↔ BRG-01 跨距 c = ${(d.X_BRG01 - d.X_BRG03).toFixed(1)}（假设）`, 0x6a1b9a);
  dimLine([d.X_G0, 26, 0], [d.X_G1, 26, 0], `绳槽段 ${d.X_G1 - d.X_G0} / 槽距 3.0（假设）`, 0xc62828);
  dimLine([d.XS0, 52, 0], [d.XS1, 52, 0], `定子叠长 ${(d.XS1 - d.XS0).toFixed(1)}（MF0095044 占位，官方）`, 0xb87333);
  dimGroup.add(label(`蜗杆 m0.5 z1 · 蜗轮 z104 · i1=1.25 → 每转 ${d.DTHETA.toFixed(2)}°（假设）`, new THREE.Vector3(d.X_EXIT + 30, d.WY + 12, d.WZ + 10)));
}
// ---------- 载荷路径 ----------
function buildLoad() {
  const L = META.load;
  const mk = (pts, color, w) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p.p)), false, 'catmullrom', 0.05);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, w, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
    tube.renderOrder = 8; loadGroup.add(tube);
    pts.forEach((p, i) => { loadGroup.add(label(`${i + 1}. ${p.n}`, new THREE.Vector3(...p.p), 'load'));
      if (i) { const a = new THREE.Vector3(...pts[i - 1].p), b = new THREE.Vector3(...p.p); const dir = b.clone().sub(a).normalize();
        const c = new THREE.Mesh(new THREE.ConeGeometry(w * 2.6, w * 7, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        c.position.copy(b.clone().addScaledVector(dir, -w * 4)); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); c.renderOrder = 9; loadGroup.add(c); } });
  };
  { const el = document.getElementById('loadF'); if (el && L.F) el.textContent = L.F; }
  mk(L.nodes, 0xd32f2f, 1.6);
  mk([L.nodes[2], ...L.branch], 0xff8f00, 1.2);
  mk([{ n: '', p: [60, 0, 30] }, ...L.torque], 0x6a1b9a, 0.9);
}
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); labelR.render(scene, camera); });
