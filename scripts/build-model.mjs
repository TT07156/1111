/**
 * build-model.mjs — 程序化生成展品「ÉCLIPSE ONE 腕表」并导出 GLB
 * 运行：npm run model   （输出 public/models/product.glb）
 * 纯几何 + PBR 材质，无贴图，可在 Node 环境直接导出。
 */
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

// Node 环境补丁：GLTFExporter 二进制导出依赖 FileReader 读取 Blob
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend && this.onloadend({ target: this });
      });
    }
  };
}
const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

const METAL = { color: 0xc8ccd4, metalness: 0.95, roughness: 0.26 };          // 缎面精钢
const METAL_POLISH = { color: 0xd6dbe3, metalness: 1.0, roughness: 0.14 };    // 抛光钢
const DARK = { color: 0x06080a, metalness: 0.25, roughness: 0.55 };           // 表盘（哑光深黑）
const BRAND = { color: 0x3d7e9f, metalness: 0.9, roughness: 0.22 };           // 品牌青蓝
const RUBBER = { color: 0x111419, metalness: 0.2, roughness: 0.7 };           // 表带内衬

const watch = new THREE.Group();
watch.name = 'ECLIPSE_ONE';

const mat = (def, name) => {
  const m = new THREE.MeshStandardMaterial(def);
  m.name = name;
  return m;
};
const mCase = mat(METAL, 'SteelBrushed');
const mPolish = mat(METAL_POLISH, 'SteelPolished');
const mDial = mat(DARK, 'Dial');
const mBrand = mat({ ...BRAND, emissive: 0x1d4257, emissiveIntensity: 0.55 }, 'BrandMetal');
const mRubber = mat(RUBBER, 'Rubber');

function add(geo, material, name, pos = [0, 0, 0], rot = null) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  watch.add(mesh);
  return mesh;
}

/* ---- 表壳（圆柱旋转至面向 +Z） ---- */
add(new THREE.CylinderGeometry(1.02, 1.07, 0.42, 96), mCase, 'Case', [0, 0, 0], [Math.PI / 2, 0, 0]);
add(new THREE.CylinderGeometry(0.9, 0.94, 0.08, 96), mPolish, 'CaseBack', [0, 0, -0.23], [Math.PI / 2, 0, 0]);

/* ---- 表圈（抛光圆环） ---- */
add(new THREE.TorusGeometry(1.0, 0.098, 40, 128), mPolish, 'Bezel', [0, 0, 0.2]);

/* ---- 表盘 ---- */
add(new THREE.CircleGeometry(0.9, 96), mDial, 'Dial', [0, 0, 0.207]);

/* ---- 时标（12 枚抛光条钉） ---- */
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  const marker = new THREE.BoxGeometry(i % 3 === 0 ? 0.045 : 0.028, 0.13, 0.03);
  add(marker, mPolish, `Index_${i}`,
    [Math.sin(a) * 0.74, Math.cos(a) * 0.74, 0.225],
    [0, 0, -a]);
}

/* ---- 指针（时针 / 分针 / 品牌色秒针） ---- */
add(new THREE.BoxGeometry(0.05, 0.46, 0.02).translate(0, 0.17, 0), mPolish, 'HandHour', [0, 0, 0.24], [0, 0, -1.05]);
add(new THREE.BoxGeometry(0.034, 0.64, 0.016).translate(0, 0.25, 0), mPolish, 'HandMinute', [0, 0, 0.255], [0, 0, 2.35]);
add(new THREE.BoxGeometry(0.014, 0.7, 0.012).translate(0, 0.27, 0), mBrand, 'HandSecond', [0, 0, 0.268], [0, 0, 0.6]);
add(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 24), mBrand, 'HandCap', [0, 0, 0.262], [Math.PI / 2, 0, 0]);

/* ---- 穹面蓝宝石镜面（浅穹帽，避免大面积环境反射造成“牛奶罩”） ---- */
const crystalMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.03,
  transparent: true, opacity: 0.025, envMapIntensity: 0.12, clearcoat: 0.4,
  depthWrite: false,
});
crystalMat.name = 'Sapphire';
const crystal = add(new THREE.SphereGeometry(0.88, 64, 24, 0, Math.PI * 2, 0, 0.85), crystalMat, 'Crystal', [0, 0, 0.2]);
crystal.scale.set(1, 1, 0.5);

/* ---- 表冠 + 按钮 ---- */
add(new THREE.CylinderGeometry(0.09, 0.09, 0.15, 32), mPolish, 'Crown', [1.14, 0, 0.02], [0, 0, Math.PI / 2]);
add(new THREE.TorusGeometry(0.092, 0.02, 16, 48), mCase, 'CrownGuard', [1.2, 0, 0.02], [0, Math.PI / 2, 0]);
add(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 24), mPolish, 'PusherTop', [0.97, 0.55, 0.02], [0, 0, 0.42]);
add(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 24), mPolish, 'PusherBottom', [0.97, -0.55, 0.02], [0, 0, -0.42]);

/* ---- 表耳 + 链节表带（上下两段弧形链节） ---- */
[[0.52, 1.0], [-0.52, 1.0], [0.52, -1.0], [-0.52, -1.0]].forEach(([x, y], i) => {
  add(new THREE.BoxGeometry(0.2, 0.3, 0.24), mCase, `Lug_${i}`, [x, y, -0.02]);
});

const RC = 1.054, CZ = -0.167; // 链节圆弧的半径与圆心 z
for (let i = 0; i < 7; i++) {
  const aTop = 1.32 + i * 0.163;
  const aBot = -aTop;
  add(new THREE.BoxGeometry(0.58, 0.1, 0.155), mRubber, `LinkTop_${i}`,
    [0, RC * Math.sin(aTop), CZ + RC * Math.cos(aTop)], [Math.PI / 2 - aTop, 0, 0]);
  add(new THREE.BoxGeometry(0.58, 0.1, 0.155), mRubber, `LinkBottom_${i}`,
    [0, RC * Math.sin(aBot), CZ + RC * Math.cos(aBot)], [Math.PI / 2 - aBot, 0, 0]);
}
/* 每段链节中央的抛光窄条，制造金属链带质感 */
for (let i = 0; i < 7; i++) {
  const aTop = 1.32 + i * 0.163;
  const aBot = -aTop;
  add(new THREE.BoxGeometry(0.2, 0.11, 0.16), mPolish, `LinkCenterTop_${i}`,
    [0, RC * Math.sin(aTop), CZ + RC * Math.cos(aTop)], [Math.PI / 2 - aTop, 0, 0]);
  add(new THREE.BoxGeometry(0.2, 0.11, 0.16), mPolish, `LinkCenterBottom_${i}`,
    [0, RC * Math.sin(aBot), CZ + RC * Math.cos(aBot)], [Math.PI / 2 - aBot, 0, 0]);
}

/* ---- 导出 GLB ---- */
const exporter = new GLTFExporter();
exporter.parse(watch, (result) => {
  const outPath = path.resolve(process.cwd(), 'public/models/product.glb');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(result));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ 已生成 ${outPath} (${kb} KB)`);
}, (err) => {
  console.error('✗ GLTFExporter 导出失败：', err);
  process.exit(1);
}, { binary: true });
