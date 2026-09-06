/**
 * main.js — 入口：初始化、渲染循环、帧率监控
 * 负责：WebGL 检测与静态降级 / 加载页（幕 1）/ Hero 入场 / 帧率监控与自动降级 /
 *      页面隐藏暂停 / prefers-reduced-motion / 移动端分支
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import { CONFIG, EASE, DUR } from './config.js';
import { createScene } from './scene.js';
import { createEffects } from './effects.js';
import { initInteractions } from './interactions.js';

// 字体（npm 包，本地打包，无 CDN）
import '@fontsource/inter/200.css';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

const $ = (s) => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
// 自动化测试钩子：?keeprun 时后台标签页也继续渲染循环
const KEEP_RUN = new URLSearchParams(location.search).has('keeprun');

/* ---------------- 启动前置检测 ---------------- */
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

/** WebGL 不可用 / 启动崩溃：静态渐变背景 + 占位图 + 文字说明，绝不白屏 */
function showFallback(err) {
  console.warn('[main] 进入静态降级模式：', err || 'WebGL 不可用');
  window.__bootError = err && err.stack ? err.stack : String(err || 'webgl unavailable');
  CONFIG.runtime.webglOK = false;
  const fb = $('#fallback');
  const loader = $('#loader');
  if (loader) loader.style.display = 'none';
  if (fb) fb.hidden = false;
  document.body.classList.add('no-webgl');
  gsap.fromTo('#fallback .fallback-card', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: 'power3.out' });
}

/* ---------------- CSS 变量注入：CONFIG 为唯一颜色来源 ---------------- */
function injectCssVars() {
  const r = document.documentElement.style;
  r.setProperty('--c-bg', CONFIG.colors.bgCss);
  r.setProperty('--c-metal', CONFIG.colors.metalCss);
  r.setProperty('--c-brand', CONFIG.colors.brandCss);
}

/* ---------------- 幕 1：加载页 ---------------- */
function initLoader(onComplete) {
  const loaderEl = $('#loader');
  const brandEl = $('.loader-brand');
  const barEl = $('.loader-bar i');
  const numEl = $('.loader-num');
  const tipEl = $('.loader-tip');
  const RM = CONFIG.runtime.reducedMotion;

  // 品牌名逐字拆分
  const text = brandEl.dataset.text || 'LUMEN';
  brandEl.innerHTML = text.split('').map((ch) => `<span>${ch}</span>`).join('');
  const letters = $$('.loader-brand span');
  if (letters.length) gsap.fromTo(letters, { autoAlpha: 0, y: 14, filter: 'blur(8px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: EASE.out, stagger: 0.07 });

  const st = { target: 0, shown: 0, done: false, start: performance.now(), finished: false };

  function paint() {
    if (barEl) barEl.style.transform = `scaleX(${st.shown})`;
    if (numEl) numEl.textContent = String(Math.round(st.shown * 100)).padStart(2, '0');
  }

  function complete() {
    if (st.finished) return;
    st.finished = true;
    const tl = gsap.timeline({ onComplete });
    if (RM) {
      tl.set(loaderEl, { autoAlpha: 0, pointerEvents: 'none' });
      return;
    }
    tl.to(letters, { autoAlpha: 0, y: -18, filter: 'blur(6px)', duration: 0.55, ease: 'power2.in', stagger: 0.04 })
      .to([$('.loader-bar'), numEl, tipEl], { autoAlpha: 0, y: -10, duration: 0.4, ease: 'power2.in' }, '<0.1')
      .to(loaderEl, { autoAlpha: 0, duration: 0.9, ease: 'power2.inOut', pointerEvents: 'none' }, '-=0.1')
      .set(loaderEl, { display: 'none' });
  }

  return {
    /** 每帧推进：显示值向真实进度 lerp，并保持最小加载时长 */
    update(dt) {
      if (st.finished) return;
      st.shown += (st.target - st.shown) * Math.min(1, dt * 4);
      const elapsed = performance.now() - st.start;
      if (st.target >= 0.999 && elapsed > CONFIG.anim.loader.minTime) {
        st.shown = 1;
        paint();
        complete();
        return;
      }
      paint();
    },
    setProgress(v) { st.target = Math.max(st.target, v); },
    /** 兜底：任何原因导致进度未完成时，超时强制进入 */
    failSafe() {
      setTimeout(() => { st.target = 1; st.shown = Math.max(st.shown, 0.98); }, CONFIG.anim.loader.failSafe);
    },
  };
}

/* ---------------- Hero 入场（加载完成后调用） ---------------- */
function playIntro(sceneApi, state) {
  const RM = CONFIG.runtime.reducedMotion;
  document.body.classList.add('is-loaded');
  const model = sceneApi.refs.current;
  const heroZ = CONFIG.keyframes.hero.pos[2];

  if (RM) {
    gsap.set(state, { introSpin: 0 });
    gsap.set(['.site-head', '.dots', '.scroll-hint'], { autoAlpha: 1 });
    $$('.hero-title .line i').forEach((el) => gsap.set(el, { yPercent: 0 }));
    gsap.set(['.hero-sub', '.hero-meta'], { autoAlpha: 1 });
    if (model) gsap.set(model.modelRoot.scale, { x: 1, y: 1, z: 1 });
    ScrollTrigger.refresh();
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: EASE.expo } });
  // 刷新时若已滚动到页中（浏览器恢复滚动位置），跳过相机运镜，避免覆盖滚动系统写入的机位
  const midPage = window.scrollY > window.innerHeight * 0.8;
  if (model) {
    tl.fromTo(model.modelRoot.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: 1.4 }, 0.1);
    tl.to(state, { introSpin: 0, duration: 1.8, ease: EASE.expo }, 0.1);
  }
  if (!midPage) {
    tl.fromTo(sceneApi.rig.pos, { z: heroZ + 2.2 }, { z: heroZ, duration: 1.7, ease: EASE.expo, overwrite: 'auto' }, 0);
  }
  tl.fromTo('.hero-title .line i', { yPercent: 118 }, { yPercent: 0, duration: 1.15, ease: EASE.out, stagger: CONFIG.anim.stagger }, 0.4)
    .fromTo(['.hero-sub', '.hero-meta'], { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE.out, stagger: 0.1 }, 0.85)
    .fromTo(['.site-head', '.dots', '.scroll-hint'], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power2.out' }, 1.0);
}

/* ================= 主启动流程 ================= */
function boot() {
  injectCssVars();

  CONFIG.runtime.isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  CONFIG.runtime.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!webglOK()) { showFallback(); return; }

  const canvas = $('#webgl');
  let sceneApi, effectsApi, interactions, loader;
  const refs = { current: null }; // 模型就绪后填充

  // 共享指针状态（interactions 写入，effects/主循环读取）
  const pointer = {
    nx: 0, ny: 0, px: window.innerWidth / 2, py: window.innerHeight / 2,
    world: new THREE.Vector3(99, 99, 99),
    modelCenter: new THREE.Vector3(),
    hovering: false, dragging: false, moved: false,
  };

  try {
    sceneApi = createScene(canvas);
    sceneApi.refs = refs;
  } catch (e) {
    showFallback(e);
    return;
  }

  try {
    effectsApi = createEffects(sceneApi.renderer, sceneApi.scene, sceneApi.camera);
  } catch (e) {
    console.warn('[main] 后处理初始化失败，回退直渲：', e);
    effectsApi = null;
  }

  interactions = initInteractions({
    canvas, camera: sceneApi.camera, rig: sceneApi.rig,
    sceneApi, effectsApi: effectsApi || {
      setConverge: () => {}, degrade: () => {}, update: () => {}, onResize: () => {}, setPixelRatioSync: () => {},
    },
    refs, pointer,
  });

  /* -------- 模型加载（LoadingManager + DRACO，失败自动占位球体） -------- */
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => {
    if (total > 0) loader && loader.setProgress(loaded / total);
  };
  loader = initLoader(() => playIntro(sceneApi, interactions.state));
  loader.failSafe();

  const forceFallback = new URLSearchParams(location.search).has('fallback');
  sceneApi.loadProduct(manager, (modelRefs) => {
    refs.current = modelRefs;
    // 加载进度到 100% 的信号（真实模型或占位球体均视为就绪）
    loader.setProgress(1);
  }, forceFallback);
  // GLTFLoader 字节级进度（比 manager 的按文件计数更平滑）
  manager.onStart = () => {};
  manager.onError = (url) => console.warn('[main] 资源加载出错：', url);

  /* -------- 渲染循环（gsap.ticker 单一 RAF，兼顾 Lenis） -------- */
  const clock = new THREE.Clock();
  const fpsEl = $('.fps');
  const perf = { frames: 0, last: performance.now(), lowSince: 0, degraded: false };

  function degrade() {
    if (perf.degraded) return;
    perf.degraded = true;
    effectsApi.degrade(() => sceneApi.setPixelRatio(CONFIG.perf.degradePixelRatio));
    effectsApi.setPixelRatioSync();
  }

  let simTime = 0;
  // frame(dtOverride)：正常路径 dt 取自时钟；自动化测试用 __step(n, dt) 同步泵模拟帧
  function frame(dtOverride) {
    const dt = dtOverride != null ? dtOverride : Math.min(0.05, clock.getDelta());
    const t = (simTime += dt);

    if (document.hidden && !KEEP_RUN) return; // 页面隐藏时暂停渲染循环

    if (interactions.lenis) interactions.lenis.raf(performance.now());
    loader && loader.update(dt);
    interactions.update(dt, t);
    if (effectsApi) effectsApi.update(dt, t, pointer);
    if (effectsApi) effectsApi.composer.render();
    else sceneApi.renderer.render(sceneApi.scene, sceneApi.camera);

    // ---- 帧率监控：连续 2s < 30fps → 自动降级 ----
    perf.frames++;
    const now = performance.now();
    const span = now - perf.last;
    if (span >= 500) {
      const fps = (perf.frames * 1000) / span;
      if (fpsEl) fpsEl.textContent = `${Math.round(fps)} FPS`;
      if (fps < CONFIG.perf.fpsFloor) {
        if (!perf.lowSince) perf.lowSince = now;
        else if (now - perf.lowSince >= CONFIG.perf.fpsWindowMs) degrade();
      } else {
        perf.lowSince = 0;
      }
      perf.frames = 0;
      perf.last = now;
    }
  }

  gsap.ticker.add(() => frame());
  gsap.ticker.lagSmoothing(0);

  // 自动化测试兜底：后台标签页 rAF 被宿主冻结时，可同步泵模拟帧
  if (KEEP_RUN) {
    window.__step = (n = 30, dt = 0.033) => { for (let i = 0; i < n; i++) frame(dt); };
  }

  /* -------- 页面隐藏时暂停（visibilitychange） -------- */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clock.getDelta(); // 回到页面时清掉积压的 delta，避免跳帧
  });

  /* -------- resize -------- */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sceneApi.onResize();
      effectsApi && effectsApi.onResize();
      effectsApi && effectsApi.setPixelRatioSync();
      ScrollTrigger.refresh();
    }, 150);
  });

  /* -------- 移动端提示与调试钩子 -------- */
  if (CONFIG.runtime.isMobile) document.body.classList.add('is-mobile');
  // 供自动化测试 / 手动排查使用
  window.__showroom = {
    lenis: interactions.lenis,
    scrollTo: (sel) => interactions.lenis ? interactions.lenis.scrollTo(sel, { immediate: true }) : 0,
    degrade,
    scene: sceneApi,
    effects: effectsApi,
    ScrollTrigger,
    config: CONFIG,
  };
}

try {
  boot();
} catch (e) {
  showFallback(e);
}
