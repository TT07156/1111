/**
 * scene.js — 场景、灯光、RoomEnvironment 环境反射、模型加载与归一化
 * 所有易错点均用 try/catch 包裹，任何失败都不会白屏（占位球体兜底）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';

const base = import.meta.env.BASE_URL || '/';

/** 生成径向光斑贴图（光晕 / 舞台地面共用） */
function makeRadialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([p, col]) => gr.addColorStop(p, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createScene(canvas) {
  const C = CONFIG;

  /* ---------------- 渲染器 ---------------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    console.warn('[scene] WebGLRenderer 创建失败：', e);
    throw e;
  }
  const isMobile = C.runtime.isMobile;
  const maxPR = isMobile ? C.perf.mobilePixelRatio : C.perf.maxPixelRatio;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = C.post.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* ---------------- 场景与相机 ---------------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.colors.bg);

  const camera = new THREE.PerspectiveCamera(
    C.camera.fov,
    window.innerWidth / window.innerHeight,
    C.camera.near,
    C.camera.far
  );

  // rig：滚动系统写「基础机位」，每帧再叠加鼠标视差，最后应用到 camera
  const rig = {
    pos: new THREE.Vector3(...C.keyframes.hero.pos),
    target: new THREE.Vector3(...C.keyframes.hero.target),
  };
  camera.position.copy(rig.pos);
  camera.lookAt(rig.target);

  /* ---------------- Studio 环境反射（RoomEnvironment + PMREM） ---------------- */
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = C.envIntensity;
    pmrem.dispose();
  } catch (e) {
    console.warn('[scene] RoomEnvironment 环境反射生成失败，金属质感将降级：', e);
  }

  /* ---------------- 灯光 ---------------- */
  const lights = {};
  try {
    lights.hemi = new THREE.HemisphereLight(C.lights.hemi.sky, C.lights.hemi.ground, C.lights.hemi.intensity);
    lights.ambient = new THREE.AmbientLight(C.lights.ambient.color, C.lights.ambient.intensity);
    lights.key = new THREE.DirectionalLight(C.lights.key.color, C.lights.key.intensity);
    lights.key.position.set(...C.lights.key.pos);
    lights.rim = new THREE.DirectionalLight(C.lights.rim.color, C.lights.rim.intensity);
    lights.rim.position.set(...C.lights.rim.pos);
    lights.fill = new THREE.DirectionalLight(C.lights.fill.color, C.lights.fill.intensity);
    lights.fill.position.set(...C.lights.fill.pos);
    lights.under = new THREE.PointLight(C.lights.under.color, C.lights.under.intensity, 7);
    lights.under.position.set(...C.lights.under.pos);

    // 跟随光标的聚光灯（decay=2 物理平方衰减，靠近模型时形成局部光池）
    const cs = C.lights.cursorSpot;
    lights.cursorSpot = new THREE.SpotLight(cs.color, cs.intensityIdle, 0, cs.angle, 1, cs.decay);
    lights.cursorSpot.position.set(...cs.pos);
    lights.cursorTarget = new THREE.Object3D();
    lights.cursorSpot.target = lights.cursorTarget;

    scene.add(
      lights.hemi, lights.ambient, lights.key, lights.rim,
      lights.fill, lights.under, lights.cursorSpot, lights.cursorTarget
    );
  } catch (e) {
    console.warn('[scene] 灯光初始化异常：', e);
  }

  /* ---------------- 体积光锥（主光 → 模型的光柱，纯加色渐变，开销极低） ---------------- */
  const volumetrics = { cone: null, glowSprite: null, stage: null };
  try {
    const coneH = 5.2;
    const coneGeo = new THREE.ConeGeometry(1.7, coneH, 48, 1, true);
    const coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(C.colors.brand).lerp(new THREE.Color(0xffffff), 0.55) },
        uIntensity: { value: 0.085 },
        uH: { value: coneH },
      },
      vertexShader: /* glsl */`
        varying float vH;
        void main() {
          vH = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vH;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uH;
        void main() {
          float k = clamp(vH / uH + 0.5, 0.0, 1.0); // 顶点(光源处)为 1
          float a = pow(k, 2.1) * uIntensity;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    const from = new THREE.Vector3(...C.lights.key.pos);
    const to = new THREE.Vector3(0, -0.2, 0);
    const dir = from.clone().sub(to).normalize();
    cone.position.copy(from.clone().add(to).multiplyScalar(0.5));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.renderOrder = 5;
    scene.add(cone);
    volumetrics.cone = cone;

    // 跟随光标的可见光斑（Sprite 光晕）
    const glowTex = makeRadialTexture([
      [0, 'rgba(255,255,255,0.85)'],
      [0.25, 'rgba(150,195,220,0.32)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.12,
    }));
    glow.scale.setScalar(4.2);
    glow.renderOrder = 6;
    scene.add(glow);
    volumetrics.glowSprite = glow;

    // 舞台地面光晕（给悬浮模型一个“落地”暗示）
    const stageTex = makeRadialTexture([
      [0, 'rgba(61,126,159,0.4)'],
      [0.5, 'rgba(61,126,159,0.12)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    const stage = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 7.5),
      new THREE.MeshBasicMaterial({
        map: stageTex, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = -1.85;
    scene.add(stage);
    volumetrics.stage = stage;
  } catch (e) {
    console.warn('[scene] 体积光/舞台初始化异常：', e);
  }

  /* ---------------- 中央展示柱（模型绕柱螺旋展示的视觉锚点） ---------------- */
  try {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 4.8, 48),
      new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.7, roughness: 0.38 })
    );
    pillar.position.y = -0.1;
    const pillarRingMat = new THREE.MeshStandardMaterial({
      color: C.colors.brand, metalness: 0.6, roughness: 0.3,
      emissive: C.colors.brand, emissiveIntensity: 0.5,
    });
    const pillarRingTop = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.022, 12, 64), pillarRingMat);
    pillarRingTop.rotation.x = Math.PI / 2;
    pillarRingTop.position.y = 2.3;
    const pillarRingBottom = pillarRingTop.clone();
    pillarRingBottom.position.y = -2.5;
    scene.add(pillar, pillarRingTop, pillarRingBottom);
    // reduced-motion 静态展示时模型停在原点，隐藏柱子避免穿插
    if (C.runtime.reducedMotion) {
      pillar.visible = pillarRingTop.visible = pillarRingBottom.visible = false;
    }
  } catch (e) {
    console.warn('[scene] 展示柱初始化异常：', e);
  }

  /* ---------------- 模型容器层级 ----------------
   * modelRoot   — 编排用（位移/缩放/淡出；绕柱螺旋也写在此层）
   *   floatGroup — 上下浮动 + 鼠标视差旋转（±3°）
   *     spinGroup — 自转 + 拖拽旋转 + 入场旋转
   */
  const modelRoot = new THREE.Group();
  const floatGroup = new THREE.Group();
  const spinGroup = new THREE.Group();
  floatGroup.add(spinGroup);
  modelRoot.add(floatGroup);
  modelRoot.visible = false; // 加载完成并由入场动画接管后可见
  scene.add(modelRoot);

  const materials = []; // { mat, baseOpacity } 供整体淡出 / 特写增强
  const raycastTargets = [];

  function collectMeshes(root) {
    root.traverse((obj) => {
      if (obj.isMesh) {
        raycastTargets.push(obj);
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => {
          if (!materials.some((m) => m.mat === mat)) {
            materials.push({ mat, baseOpacity: mat.opacity ?? 1 });
          }
        });
      }
    });
  }

  /** 金属中框等哑光产品材质适配：压金属度、提粗糙度（透明/透射材质跳过粗糙度，保留贴图） */
  function adaptMaterials(root) {
    const A = C.model.adapt;
    if (!A) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return;
        m.metalness = Math.min(m.metalness ?? 0, A.maxMetalness);
        if (!m.transparent && !m.transmission) m.roughness = Math.max(m.roughness ?? 1, A.minRoughness);
        m.envMapIntensity = A.envIntensity;
      });
    });
  }

  /** 所有幕的相机到原点的最近距离（autoFit 用） */
  function minCameraDistance() {
    const K = C.keyframes;
    const pts = [
      K.hero.pos, ...K.galleryCurve,
      K.details.A.pos, K.details.B.pos, K.details.C.pos,
      K.specs.desktop.pos, K.specs.mobile.pos, K.cta.pos,
    ];
    return Math.min(...pts.map((p) => Math.hypot(p[0], p[1], p[2])));
  }

  /**
   * 居中 + 归一化 + 自动取景：
   * 1) 自动扶正：把包围盒最薄的轴转向相机（Z）——手机中框等扁平模型无论怎么导出都正对镜头
   * 2) 包围盒最大边缩放到 model.targetSize
   * 3) autoFit：按「包围球直径 ≤ 最近机位可视高度 × screenRatio」二次缩放，
   *    数学上保证任何一幕、任何旋转姿态下模型完整入画且占屏高 ≤ 60%
   * @returns halfSize 最终包围盒半尺寸 Vector3（供部件锚点定位）
   */
  function normalize(root) {
    let box = new THREE.Box3().setFromObject(root);
    let size = box.getSize(new THREE.Vector3());
    let center = box.getCenter(new THREE.Vector3());

    const A = C.model.adapt;
    if (A && A.upright) {
      const thinY = size.y <= size.x && size.y <= size.z;  // 厚度朝上（躺平）
      const thinX = !thinY && size.x <= size.z;            // 厚度朝侧（侧立）
      if (thinY) root.rotation.x = Math.PI / 2;
      else if (thinX) root.rotation.y = Math.PI / 2;
      if (root.rotation.x || root.rotation.y) {
        root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        size = box.getSize(new THREE.Vector3());
        center = box.getCenter(new THREE.Vector3());
      }
    }

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s1 = C.model.targetSize / maxDim;
    root.position.sub(center).multiplyScalar(s1);
    root.scale.setScalar(s1);

    if (C.model.autoFit) {
      const diag = size.length() * s1; // 包围球直径 = 任意旋转姿态下屏幕投影的保守上界
      const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(C.camera.fov) / 2) * minCameraDistance();
      const maxDiag = visibleH * C.model.screenRatio;
      if (diag > maxDiag) {
        const s2 = maxDiag / diag;
        root.scale.multiplyScalar(s2);
        root.position.multiplyScalar(s2);
        console.warn(`[scene] autoFit：模型偏大，已自动缩放 ×${s2.toFixed(2)} 以保证完整显示`);
      }
    }
    return size.clone().multiplyScalar(root.scale.x).divideScalar(2);
  }

  /** 幕 4 部件定位锚点（anchor 为相对包围盒半尺寸的系数；挂在 spinGroup 上随模型旋转） */
  function createAnchors(half) {
    return C.hotspots.map((h) => {
      const obj = new THREE.Object3D();
      obj.position.set(h.anchor[0] * half.x, h.anchor[1] * half.y, h.anchor[2] * half.z);
      obj.name = `anchor-${h.id}`;
      spinGroup.add(obj);
      return { id: h.id, seg: h.seg, obj };
    });
  }

  /** 占位球体：product.glb 缺失 / 加载失败时的兜底，绝不白屏 */
  function buildFallback() {
    console.warn('[scene] 未找到或加载失败 product.glb —— 已切换为占位球体。请将模型放入 public/models/product.glb');
    const g = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 64, 32),
      new THREE.MeshStandardMaterial({
        color: C.colors.metal, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.2,
      })
    );
    sphere.name = 'PlaceholderSphere';
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.035, 24, 128),
      new THREE.MeshStandardMaterial({
        color: C.colors.brand, metalness: 0.9, roughness: 0.25,
        emissive: C.colors.brand, emissiveIntensity: 0.35,
      })
    );
    ring.rotation.x = Math.PI / 2.4;
    g.add(sphere, ring);
    return g;
  }

  /**
   * 加载 product.glb（GLTFLoader + DRACOLoader + LoadingManager）
   * @param manager THREE.LoadingManager（供加载页统计进度）
   * @param onReady (refs) => void  模型就绪（真实模型或占位球体）
   * @param forceFallback 测试钩子：?fallback=1 时跳过真实加载
   */
  function loadProduct(manager, onReady, forceFallback = false) {
    const finish = (object, isFallback) => {
      try {
        if (!isFallback) adaptMaterials(object); // 金属中框哑光材质适配（占位球体保持金属质感）
        const half = normalize(object);          // 自动扶正 + 居中 + 归一化 + autoFit
        spinGroup.add(object);
        collectMeshes(spinGroup);
        const anchors = createAnchors(half);
        const center = new THREE.Vector3(0, 0, 0); // normalize 后几何中心即原点
        modelRoot.visible = true; // 就绪后可见（入场动画接管缩放）
        onReady({
          modelRoot, floatGroup, spinGroup,
          materials, raycastTargets, anchors,
          center, radius: half.length(),
          isFallback,
        });
      } catch (e) {
        console.warn('[scene] 模型后处理失败，尝试占位球体：', e);
        finish(buildFallback(), true);
      }
    };

    if (forceFallback) {
      finish(buildFallback(), true);
      return;
    }

    try {
      const draco = new DRACOLoader();
      draco.setDecoderPath(base + C.model.dracoDecoderPath);
      const loader = new GLTFLoader(manager);
      loader.setDRACOLoader(draco);

      loader.load(
        base + C.model.url,
        (gltf) => {
          try {
            finish(gltf.scene, false);
          } catch (e) {
            console.warn('[scene] GLTF 内容解析失败：', e);
            finish(buildFallback(), true);
          }
        },
        undefined, // 字节级进度由 manager/外部 onProgress 接管
        (err) => {
          console.warn('[scene] product.glb 加载失败：', err);
          finish(buildFallback(), true);
        }
      );
    } catch (e) {
      console.warn('[scene] GLTFLoader 初始化异常：', e);
      finish(buildFallback(), true);
    }
  }

  /** 整体淡出/恢复（幕 6 与回退共用；v=1 完全可见） */
  function setModelOpacity(v) {
    const solid = v > 0.999;
    materials.forEach(({ mat, baseOpacity }) => {
      mat.transparent = !solid || baseOpacity < 1;
      mat.opacity = baseOpacity * v;
    });
    modelRoot.visible = v > 0.01;
  }

  /** 幕 4 特写：金属反射增强 + 局部打光（e: 0→1） */
  function setMacroBoost(e) {
    const M = C.lights.macroBoost;
    scene.environmentIntensity = C.envIntensity + M.env * e;
    lights.key.intensity = C.lights.key.intensity + M.key * e;
    lights.fill.intensity = C.lights.fill.intensity + M.fill * e;
    lights.rim.intensity = C.lights.rim.intensity + M.key * 0.4 * e;
  }

  /** 窗口尺寸变化 */
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    // 窄屏（手机竖屏）增大视场角，保证模型完整入画
    camera.fov = camera.aspect < 0.8 ? 62 : C.camera.fov;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /** 降级时进一步压低像素比 */
  function setPixelRatio(pr) {
    renderer.setPixelRatio(Math.min(pr, maxPR));
  }

  return {
    renderer, scene, camera, rig, lights, volumetrics,
    loadProduct, setModelOpacity, setMacroBoost, onResize, setPixelRatio,
    getPixelRatio: () => renderer.getPixelRatio(),
  };
}
