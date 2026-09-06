/**
 * CONFIG — 全站唯一的参数源
 * 所有颜色 / 强度 / 时长 / 缓动 / 相机机位 / 性能阈值都集中在这里，方便整体替换调性。
 * 注意：CSS :root 中的同名变量会在启动时由本文件注入（单一来源）。
 */
export const CONFIG = {
  /* ---------------- 品牌视觉（三个核心色，替换这里即可换肤） ---------------- */
  colors: {
    bg: 0x050507,      // 深空黑背景
    metal: 0xc8ccd4,   // 主体金属银
    brand: 0x3d7e9f,   // 品牌青蓝
    rim: 0xffb37a,     // 暖色轮廓逆光
    text: '#c8ccd4',
    textDim: 'rgba(200,204,212,0.45)',
    brandCss: '#3d7e9f',
    metalCss: '#c8ccd4',
    bgCss: '#050507',
  },

  /* ---------------- 相机与运镜 ---------------- */
  camera: { fov: 42, near: 0.1, far: 120 },
  // 相机轻推近 + 微横摆，模型由绕柱螺旋驱动；target 每帧咬住模型（“一直在画面里”）
  // 所有相机距离 ≥ 5.2，配合 autoFit 保证模型完整入画、占屏高 ≤ 60%
  keyframes: {
    hero: { pos: [0.4, 0.55, 7.2], target: [1.9, 0.85, 0] }, // 对准螺旋起点（柱右侧）
    galleryCurve: [
      [-0.6, 0.50, 7.2],
      [0.3, 0.45, 6.5],
      [-0.3, 0.30, 5.7],
      [0.0, 0.10, 5.2],
    ],
    galleryTarget: [0, 0.05, 0], // 仅作 y 基准；x/y 由模型螺旋位置驱动
    details: {
      A: { pos: [0, 0.12, 6.4], target: [0, 0.06, 0] },        // 正面段（target 实际跟随模型）
      B: { pos: [3.9, 0.6, -5.1], target: [0, 0.06, 0] },      // 背面段
      C: { pos: [5.5, 0.25, 2.7], target: [0, 0.06, 0] },      // 侧边段
    },
    specs: {
      desktop: { pos: [-0.5, 0.7, 9.4], target: [-1.7, 0.6, 0] }, // 模型停左上，数据面板让位到右
      mobile: { pos: [0, 0.75, 9.6], target: [0, 0.6, 0] },
    },
    cta: { pos: [0, 0.42, 6.8], target: [0, 0.35, 0] },
  },
  // 幕 5 / 幕 6 中模型的停靠位置：specs 滑向左上角给数据面板让位，cta 回到中央
  modelRest: {
    specs: { desktop: [-2.2, 0.9, 0], mobile: [0, 1.05, 0] },
    cta: [0, 0.12, 0],
  },

  /* ---------------- 滚动区间（ScrollTrigger pin 长度） ---------------- */
  scroll: {
    gallery: '+=260%', // 幕 3 锁定整屏的滚动距离
    details: '+=300%', // 幕 4 三个机位
  },

  /* ---------------- 模型 ---------------- */
  model: {
    url: 'models/product.glb',
    dracoDecoderPath: 'draco/', // 本地解码器（由 three 自带文件拷贝，无 CDN）
    targetSize: 2.3,      // 归一化：包围盒最大边 → 该尺寸（世界单位）
    screenRatio: 0.6,     // autoFit 上限：任意机位、任意旋转姿态下，模型占屏高 ≤ 60%
    autoFit: true,        // 加载后按包围盒 + 相机 fov 自动二次缩放（防溢出兜底）
    idleSpinSpeed: 0.3,         // 展台自转 rad/s（一圈约 21 秒，转转转）
    idleResumeDelay: 3,         // 拖拽松手后多少秒恢复自转
    float: { amp: 0.06, speed: 0.85 }, // 上下浮动（保留）
    // 绕柱螺旋：滚动页面时模型绕中央展示柱螺旋下走 + 公转（“往下走、转转转”）
    // galleryShare：螺旋前段分配给幕 3 的比例（其余给幕 4）
    spiral: { radius: 1.9, turns: 2.2, yTop: 0.85, yBottom: -0.65, zSquash: 0.6, galleryShare: 0.45 },
    // 白色哑光 CNC 中框材质适配（加载后统一处理；transparent/透射材质跳过粗糙度）
    adapt: { upright: true, maxMetalness: 0.2, minRoughness: 0.6, envIntensity: 0.5 },
  },
  drag: {
    sens: 0.006,         // 拖拽灵敏度 rad/px（转一整圈 ≈ 1047px，跟手不飘）
    inertiaDecay: 5,     // 松手后惯性衰减（轻微惯性，缓慢停下）
    velClamp: 2.5,       // 惯性初速度上限 rad/s（防甩过头）
    tiltClamp: 0.524,    // 垂直拖拽上限 rad（±30°，防止翻面）
  },
  zoom: {
    min: 0.7,            // 缩小下限（看整体）
    max: 1.75,           // 放大上限（最近机位下仍保证模型完整、不穿模）
    wheelFactor: 1.09,   // 滚轮每格缩放系数
    lerp: 6,             // 缩放平滑趋近速度
  },

  /* ---------------- 鼠标视差 ---------------- */
  parallax: {
    camera: 0.3,        // 相机视差幅度（±0.3 世界单位）
    cameraY: 0.22,
    look: 0.09,         // lookAt 的反向微偏移，制造“分层”
    modelDeg: 3,        // 模型视差旋转（±3°）
    lerp: 0.055,        // 缓动系数
    particles: 0.55,    // 粒子层反向偏移（与相机层不同步 → 分层视差）
  },

  /* ---------------- 灯光 ---------------- */
  lights: {
    hemi: { sky: 0x2f3640, ground: 0x050507, intensity: 0.45 },
    ambient: { color: 0x1a2026, intensity: 0.25 },
    key: { color: 0xffffff, intensity: 1.35, pos: [0.6, 3.8, 2.4] },   // 柔和顶光
    rim: { color: 0xbfd4e0, intensity: 1.8, pos: [-2.8, 1.4, -3.0] },  // 冷银轮廓逆光
    fill: { color: 0x8fb8cc, intensity: 0.5, pos: [-2.4, -0.6, 2.8] }, // 左前补光
    under: { color: 0x3d7e9f, intensity: 1.6, pos: [0, -1.5, 1.6] },
    // 幕 4 特写机位的“金属反射增强 / 局部打光”增量
    macroBoost: { env: 0.15, key: 0.5, fill: 0.3 },
    cursorSpot: { color: 0xbfd8e8, intensityIdle: 22, intensityHover: 65, angle: 0.55, pos: [0, 3.2, 2.6], decay: 2 },
  },
  envIntensity: 0.38,

  /* ---------------- 后处理 ---------------- */
  post: {
    bloom: { strength: 0.35, radius: 0.72, threshold: 0.9 },
    dof: { aperture: 0.00042, maxblur: 0.0072, focusOffset: 0.0, focusLerp: 0.08 },
    grade: { aberration: 0.006, grain: 0.05, vignette: 0.55, vignetteStart: 0.45, vignetteEnd: 1.15 },
    exposure: 0.88,
  },

  /* ---------------- 粒子（星尘） ---------------- */
  particles: {
    countDesktop: 2200,
    countMobile: 1100,   // 移动端减半
    size: 0.95,
    driftAmp: 0.6,
    repelRadius: 2.6,    // 鼠标斥力半径
    repelStrength: 0.85, // 斥力强度
    colorA: '#8fa8bc',
    colorB: '#3d7e9f',
  },

  /* ---------------- 动效时长 / 缓动（全站统一） ---------------- */
  anim: {
    dur: { fast: 0.8, base: 1.0, slow: 1.4 },
    ease: { out: 'power3.out', expo: 'expo.out', inOut: 'power3.inOut' },
    loader: { minTime: 1400, failSafe: 15000 },
    stagger: 0.12,
  },

  /* ---------------- 自定义光标 ---------------- */
  cursor: {
    ringLerp: 0.16,
    dotLerp: 0.55,
    hoverScale: 1.9,
    labelDrag: '拖动旋转 360° · 滚轮缩放',
    labelView: '拖动旋转 360° · 滚轮缩放',
  },

  /* ---------------- 性能与降级 ---------------- */
  perf: {
    maxPixelRatio: 2,          // 桌面像素比 clamp
    mobilePixelRatio: 1.5,     // 移动端 clamp
    fpsFloor: 30,              // 低于该帧率…
    fpsWindowMs: 2000,         // …持续 2 秒 → 自动降级
    degradePixelRatio: 1,
  },

  /* ---------------- 数据幕内容（幕 5，手机中框示例值，可直接修改） ---------------- */
  specs: {
    cards: [
      { v: 158.3, dec: 1, unit: 'MM', label: '中框长度' },
      { v: 76.7, dec: 1, unit: 'MM', label: '中框宽度' },
      { v: 7.8, dec: 1, unit: 'MM', label: '整机厚度' },
      { v: 26, dec: 0, unit: 'G', label: '中框重量' },
      { v: 6061, dec: 0, unit: 'AL', label: '航空铝合金' },
      { v: 0.02, dec: 2, unit: 'MM', label: 'CNC 公差' },
    ],
    radar: {
      axes: ['精度', '质感', '强度', '轻量', '散热'],
      values: [0.96, 0.92, 0.9, 0.85, 0.88],
    },
    spark: {
      title: 'QC · 30 天良率抽检（%）',
      // 确定性示例数据，方便以后替换为实测值
      values: [98.2, 98.6, 97.9, 98.8, 99.1, 98.4, 97.6, 98.9, 99.3, 98.5, 98.0, 98.7, 99.2, 98.3, 98.9, 99.4, 98.6, 98.1, 98.8, 99.2, 98.5, 99.0, 98.7, 98.3, 99.1, 98.8, 99.3, 98.6, 99.0, 98.9],
    },
  },

  /* ---------------- 部件定位标签（幕 4，按机位段显示；anchor 为相对包围盒半尺寸的系数） ---------------- */
  hotspots: [
    { id: 'slot', seg: 0, anchor: [0, 0.72, 1], title: 'TOP SLOT 顶部凹槽', text: 'CNC 精铣凹槽 · 卡扣严丝合缝' },
    { id: 'texture', seg: 1, anchor: [0, -0.1, -1], title: 'BACK TEXTURE 背板纹理', text: '细腻喷砂 · 质感均匀' },
    { id: 'buttonhole', seg: 2, anchor: [1, 0.2, 0], title: 'BUTTON HOLE 按键孔', text: '侧边按键孔 · 定位精准' },
  ],

  /* ---------------- 运行时状态（由 main.js 写入，勿手改） ---------------- */
  runtime: {
    isMobile: false,
    reducedMotion: false,
    webglOK: true,
  },
};

/** 预设缓动别名（保持调用处简洁） */
export const EASE = CONFIG.anim.ease;
export const DUR = CONFIG.anim.dur;
