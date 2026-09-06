/**
 * interactions.js — 鼠标视差 / 拖拽旋转 / 滚动驱动运镜 / 自定义光标 / 数据幕
 * 全部基于 pointer events，移动端自动退化为 touch 拖拽逻辑。
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import Lenis from 'lenis';
import { CONFIG, EASE, DUR } from './config.js';

gsap.registerPlugin(ScrollTrigger);

  const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = THREE.MathUtils.clamp;

export function initInteractions(ctx) {
  const { camera, rig, sceneApi, effectsApi, refs, pointer } = ctx;
  const isMobile = CONFIG.runtime.isMobile;
  const RM = CONFIG.runtime.reducedMotion;
  const C = CONFIG;

  // 拖拽提示文案（移动端去掉“左键”）
  const dragHintText = document.querySelector('.drag-hint .dh-text');
  if (dragHintText) dragHintText.textContent = isMobile ? '按住拖动 · 360° 查看' : '按住左键拖动 · 360° 查看';

  /* ================= 对外共享状态 ================= */
  const state = {
    introSpin: -0.5,           // 入场轻微转身（由加载完成的 intro 时间线驱动到 0）
    idleSpin: 0,               // 展台自转累计（拖拽中暂停，松手倒计时结束后恢复）
    idleCountdown: 0,          // 自转恢复倒计时（秒）：拖拽松手 / 离开幕 4 时重置
    scrollSpin: 0,             // 滚动自转角（已停用，恒为 0，保留字段兼容吸附逻辑）
    dragOffset: new THREE.Vector2(0, 0),
    dragVel: 0,
    dragging: false,
    zoom: 1,                   // 当前缩放（平滑趋近 zoomTarget）
    zoomTarget: 1,             // 目标缩放（滚轮/捏合写入）
    detailsActive: false,      // 是否处于幕 4（用于热点投影 / 光标文案）
    ctaProgress: 0,            // 幕 6 进度（光晕增强）
    detailsSeg: 0,
  };
  const par = { nx: 0, ny: 0 }; // 视差当前值（lerp 后）

  /* ================= Lenis 平滑滚动 ================= */
  let lenis = null;
  try {
    if (!RM) {
      lenis = new Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.4,
      });
      lenis.on('scroll', ScrollTrigger.update);
    }
  } catch (e) {
    console.warn('[interactions] Lenis 初始化失败，回退原生滚动：', e);
  }

  /* ================= 机位工具 ================= */
  const kf = () => {
    const K = C.keyframes;
    return {
      hero: K.hero,
      specs: isMobile ? K.specs.mobile : K.specs.desktop,
      cta: K.cta,
      specModelPos: isMobile ? C.modelRest.specs.mobile : C.modelRest.specs.desktop,
    };
  };
  const v3 = (a) => new THREE.Vector3(...a);
  const galleryCurve = new THREE.CatmullRomCurve3(C.keyframes.galleryCurve.map(v3));
  const galleryEndPos = galleryCurve.getPoint(1);
  const galleryTargetV = v3(C.keyframes.galleryTarget);

  /** 绕柱螺旋：s∈[0,1]（gallery+details 滚动进度）→ 模型绕柱位置（下走 + 公转 turns 圈） */
  const spiralAt = (s) => {
    const S = C.model.spiral;
    const th = s * Math.PI * 2 * S.turns;
    return new THREE.Vector3(
      Math.cos(th) * S.radius,
      S.yTop + (S.yBottom - S.yTop) * s,
      Math.sin(th) * S.radius * S.zSquash
    );
  };
  let spiralInit = false;

  /** 在机位停靠点之间做 smoothstep 插值（机位切换顺滑无顿挫） */
  function sampleStops(stops, p, outPos, outTarget) {
    let i = 0;
    while (i < stops.length - 2 && p > stops[i + 1].at) i++;
    const a = stops[i], b = stops[i + 1];
    const span = Math.max(1e-5, b.at - a.at);
    let t = clamp((p - a.at) / span, 0, 1);
    t = t * t * (3 - 2 * t);
    outPos.lerpVectors(a.pos, b.pos, t);
    outTarget.lerpVectors(a.target, b.target, t);
  }

  const D = C.keyframes.details;
  const detailStops = [
    { at: 0.0,  pos: galleryEndPos,      target: galleryTargetV },
    { at: 0.1,  pos: v3(D.A.pos),        target: v3(D.A.target) },
    { at: 0.32, pos: v3(D.A.pos),        target: v3(D.A.target) }, // 停留：正面
    { at: 0.56, pos: v3(D.B.pos),        target: v3(D.B.target) }, // → 45° 半侧
    { at: 0.74, pos: v3(D.B.pos),        target: v3(D.B.target) }, // 停留
    { at: 0.98, pos: v3(D.C.pos),        target: v3(D.C.target) }, // → 局部特写
    { at: 1.0,  pos: v3(D.C.pos),        target: v3(D.C.target) },
  ];

  const tmpPos = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  /* ================= 指针（鼠标 + 触摸统一） ================= */
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const dragSphere = new THREE.Sphere(new THREE.Vector3(), 1.3); // 模型包围球（动态更新圆心）

  window.addEventListener('pointermove', (e) => {
    pointer.px = e.clientX;
    pointer.py = e.clientY;
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.moved = true;
    if (state.dragging) applyDrag(e.clientX, e.clientY);
  }, { passive: true });

  /** 拖拽旋转：左右 360° 自由，上下限 ±30°；记录速度供惯性 */
  function applyDrag(x, y) {
    const dx = x - dragLast.x, dy = y - dragLast.y;
    dragLast.set(x, y);
    const s = C.drag.sens;
    state.dragOffset.y += dx * s;
    state.dragOffset.x = clamp(state.dragOffset.x + dy * s, -C.drag.tiltClamp, C.drag.tiltClamp);
    state.dragVel = clamp(dx * s, -C.drag.velClamp, C.drag.velClamp);
  }
  const dragLast = new THREE.Vector2();

  /* ---- 多指跟踪（双指捏合缩放） ---- */
  const activePointers = new Map();
  let pinchBaseDist = 0, pinchBaseZoom = 1;

  window.addEventListener('pointerdown', (e) => {
    if (e.target !== ctx.canvas || !refs.current) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 双指 → 捏合缩放，取消单指旋转
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinchBaseDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      pinchBaseZoom = state.zoomTarget;
      state.dragging = false;
      pointer.dragging = false;
      state.dragVel = 0;
      cursorEl && cursorEl.classList.remove('is-down');
      return;
    }
    if (activePointers.size > 2) return;
    // 单指：命中模型才旋转（射线与包围球求交——模型浮游漂移时也能按到，且不误触空白区）
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    refs.current.floatGroup.getWorldPosition(dragSphere.center);
    dragSphere.radius = (refs.current.radius || 1.3) + 0.25;
    if (raycaster.ray.intersectsSphere(dragSphere)) {
      state.dragging = true;
      pointer.dragging = true;
      dragLast.set(e.clientX, e.clientY);
      state.dragVel = 0;
      document.body.classList.add('has-dragged'); // 首次拖拽后永久隐藏“360° 查看”提示
      cursorEl && cursorEl.classList.add('is-down');
    }
  }, { passive: true });

  window.addEventListener('pointermove', (e) => {
    pointer.px = e.clientX;
    pointer.py = e.clientY;
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.moved = true;
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 双指捏合 → 缩放
    if (activePointers.size === 2 && pinchBaseDist > 0) {
      const [a, b] = [...activePointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 1) state.zoomTarget = clamp(pinchBaseZoom * (d / pinchBaseDist), C.zoom.min, C.zoom.max);
      return;
    }
    if (state.dragging) applyDrag(e.clientX, e.clientY);
  }, { passive: true });

  const endPointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchBaseDist = 0;
    if (state.dragging) {
      state.dragging = false;
      pointer.dragging = false;
      // 松手 3 秒后恢复展台转盘
      state.idleCountdown = C.model.idleResumeDelay;
      cursorEl && cursorEl.classList.remove('is-down');
    }
  };
  window.addEventListener('pointerup', endPointer, { passive: true });
  window.addEventListener('pointercancel', endPointer, { passive: true });

  /* ---- 滚轮缩放：悬停在模型上时缩放，其余情况放行页面滚动 ---- */
  window.addEventListener('wheel', (e) => {
    if (!pointer.hovering) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // 拦下 Lenis，避免边缩放边滚页
    const f = e.deltaY > 0 ? 1 / C.zoom.wheelFactor : C.zoom.wheelFactor;
    state.zoomTarget = clamp(state.zoomTarget * f, C.zoom.min, C.zoom.max);
  }, { passive: false, capture: true });

  /* ================= 自定义光标（圆点 + 拖尾环 + 文案） ================= */
  let cursorEl, curDot, curRing, curLabel;
  const cur = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2 };
  const isFinePointer = window.matchMedia('(pointer: fine)').matches;
  if (isFinePointer) {
    cursorEl = $('.cursor');
    curDot = $('.cursor-dot');
    curRing = $('.cursor-ring');
    curLabel = $('.cursor-label');
    document.body.classList.add('has-cursor');
    // 链接/按钮 hover 反馈
    document.addEventListener('pointerover', (e) => {
      if (e.target.closest && e.target.closest('[data-cursor]')) cursorEl.classList.add('is-link');
    });
    document.addEventListener('pointerout', (e) => {
      if (e.target.closest && e.target.closest('[data-cursor]')) cursorEl.classList.remove('is-link');
    });
  }

  /* ================= 滚动驱动（GSAP ScrollTrigger） ================= */
  const capEls = $$('.sec--gallery .cap');
  const trackEl = $('.gallery-track');
  const hotspotEls = {};
  C.hotspots.forEach((h) => (hotspotEls[h.id] = $(`#hotspot-${h.id}`)));

  function setCaptions(idx) {
    capEls.forEach((el, i) => el.classList.toggle('is-active', i === idx));
  }

  if (!RM) {
    /* ---- 幕 3：pin + 曲线推近 + 自转绑定滚动（scrub:1，滚动越快转得越快） ---- */
    const gal = { p: 0 };
    gsap.to(gal, {
      p: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: '#gallery', start: 'top top', end: C.scroll.gallery,
        pin: true, scrub: 1,
        onUpdate(self) {
          const p = self.progress;
          galleryCurve.getPoint(p, tmpPos);
          rig.pos.copy(tmpPos);
          // 绕柱螺旋：模型绕中央展示柱公转 + 螺旋下走；相机 target 咬住模型（一直在画面里）
          const s = p * C.model.spiral.galleryShare;
          if (refs.current) {
            refs.current.modelRoot.position.copy(spiralAt(s));
            rig.target.copy(refs.current.modelRoot.position);
          }
          state.scrollSpin = 0; // 自转由展台逻辑接管
          const seg = Math.min(capEls.length - 1, Math.floor(p * capEls.length));
          setCaptions(seg);
          if (trackEl) trackEl.textContent = `KEEP SCROLLING — ${String(Math.round(p * 100)).padStart(2, '0')}%`;
        },
      },
    });

    /* ---- 幕 4：pin + 三机位停靠 + 特写打光 ---- */
    const det = { p: 0 };
    gsap.to(det, {
      p: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: '#details', start: 'top top', end: C.scroll.details,
        pin: true, scrub: 1,
        onToggle(self) {
          state.detailsActive = self.isActive;
          if (self.isActive) {
            // 进入细节幕：拖拽偏移吸附到整圈，保证“正面/背面/侧边”构图受控
            const TAU = Math.PI * 2;
            gsap.to(state.dragOffset, {
              x: 0, y: Math.round(state.dragOffset.y / TAU) * TAU,
              duration: 1.2, ease: 'power3.inOut', overwrite: 'auto',
            });
          } else {
            C.hotspots.forEach((h) => hotspotEls[h.id] && hotspotEls[h.id].classList.remove('is-active'));
            sceneApi.setMacroBoost(0);
            state.idleCountdown = 0.4; // 离开细节幕后稍候恢复浮游
          }
        },
        onUpdate(self) {
          const p = self.progress;
          sampleStops(detailStops, p, rig.pos, rig.target);
          state.scrollSpin = 0; // 自转由展台逻辑接管（幕 4 内暂停以稳定标签构图）
          // 螺旋后段：模型继续绕柱下走，相机 target 咬住模型
          const s = C.model.spiral.galleryShare + p * (1 - C.model.spiral.galleryShare);
          if (refs.current) {
            refs.current.modelRoot.position.copy(spiralAt(s));
            rig.target.copy(refs.current.modelRoot.position);
          }
          // 特写机位：金属反射增强 + 局部打光（0.7 之后渐入）
          const e = clamp((p - 0.7) / 0.26, 0, 1);
          sceneApi.setMacroBoost(e * e * (3 - 2 * e));
          const seg = p < 0.44 ? 0 : p < 0.79 ? 1 : 2;
          if (seg !== state.detailsSeg) state.detailsSeg = seg;
          // 每帧都应用（保证初次进入即点亮对应标签）
          C.hotspots.forEach((h) => hotspotEls[h.id] && hotspotEls[h.id].classList.toggle('is-active', h.seg === state.detailsSeg));
        },
      },
    });

    /* ---- 幕 5：数据幕机位（非 pin，进出平滑 tween） ---- */
    const toSpecs = () => {
      const k = kf();
      gsap.to(rig.pos, { x: k.specs.pos[0], y: k.specs.pos[1], z: k.specs.pos[2], duration: DUR.slow, ease: EASE.inOut, overwrite: 'auto' });
      gsap.to(rig.target, { x: k.specs.target[0], y: k.specs.target[1], z: k.specs.target[2], duration: DUR.slow, ease: EASE.inOut, overwrite: 'auto' });
      if (refs.current) {
        gsap.to(refs.current.modelRoot.position, { x: k.specModelPos[0], y: k.specModelPos[1], z: k.specModelPos[2], duration: DUR.slow, ease: EASE.inOut, overwrite: 'auto' });
      }
      sceneApi.setMacroBoost(0);
    };
    const backFromSpecs = () => {
      gsap.to(rig.pos, { x: D.C.pos[0], y: D.C.pos[1], z: D.C.pos[2], duration: DUR.slow, ease: EASE.inOut, overwrite: 'auto' });
      gsap.to(rig.target, { x: D.C.target[0], y: D.C.target[1], z: D.C.target[2], duration: DUR.slow, ease: EASE.inOut, overwrite: 'auto' });
      // 模型位置不 tween：回滚进幕 3/4 的 scrub 会立即接管螺旋轨道
    };
    ScrollTrigger.create({
      trigger: '#specs', start: 'top 72%', end: 'bottom 35%',
      onEnter: toSpecs, onEnterBack: toSpecs, onLeaveBack: backFromSpecs,
    });

    /* ---- 幕 6：定格淡出 + 粒子向光收拢（scrub 可逆） ----
     * 注意：逻辑放在补间自身的 onUpdate（scrub 追赶期间每帧触发），
     * 而不是 ScrollTrigger.onUpdate（只在滚动事件时触发一次，快速滚动会丢帧）。 */
    const cta = { p: 0 };
    const ctaFromPos = new THREE.Vector3();
    const ctaFromTarget = new THREE.Vector3();
    const ctaFromModel = new THREE.Vector3();
    let ctaStarted = false;
    gsap.to(cta, {
      p: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: '#cta', start: 'top 92%', end: 'top 22%', scrub: 0.6,
        onLeaveBack() {
          sceneApi.setModelOpacity(1);
          effectsApi.setConverge(0);
          ctaStarted = false;
        },
      },
      onUpdate() {
        const p = cta.p;
        const e = p * p * (3 - 2 * p);
        if (!ctaStarted && refs.current && p > 0.001) {
          ctaStarted = true;
          ctaFromPos.copy(rig.pos);
          ctaFromTarget.copy(rig.target);
          ctaFromModel.copy(refs.current.modelRoot.position);
          // 停掉 specs 的机位/模型补间，避免互相覆盖
          gsap.killTweensOf([rig.pos, rig.target, refs.current.modelRoot.position]);
        }
        const k = kf();
        rig.pos.lerpVectors(ctaFromPos, v3(k.cta.pos), e);
        rig.target.lerpVectors(ctaFromTarget, v3(k.cta.target), e);
        if (refs.current) {
          refs.current.modelRoot.position.lerpVectors(ctaFromModel, v3(C.modelRest.cta), e);
        }
        sceneApi.setModelOpacity(1 - e);
        effectsApi.setConverge(e);
        state.ctaProgress = e;
      },
    });
  } else {
    /* ---- reduced-motion：关闭运镜，静态机位 + 手动切换按钮 ---- */
    document.body.classList.add('rm');
    const setPose = (pose, boost = 0) => {
      rig.pos.set(...pose.pos);
      rig.target.set(...pose.target);
      sceneApi.setMacroBoost(boost);
    };
    const k = kf();
    state.scrollSpin = 0.6;
    const secPoses = [
      { el: '#hero', pose: { pos: C.keyframes.hero.pos, target: [0, 0.05, 0] } }, // RM：模型停在原点
      { el: '#gallery', pose: { pos: galleryCurve.getPoint(0.5).toArray(), target: C.keyframes.galleryTarget } },
      { el: '#details', pose: D.A },
      { el: '#specs', pose: { pos: k.specs.pos, target: k.specs.target } },
      { el: '#cta', pose: C.keyframes.cta },
    ];
    secPoses.forEach(({ el, pose }) => {
      ScrollTrigger.create({
        trigger: el, start: 'top 55%', end: 'bottom 45%',
        onEnter: () => setPose(pose),
        onEnterBack: () => setPose(pose),
      });
    });
      ScrollTrigger.create({
        trigger: '#details', start: 'top 55%', end: 'bottom 45%',
        onToggle(self) {
          state.detailsActive = self.isActive;
          const bar = $('.pose-switch');
          if (bar) bar.hidden = !self.isActive;
          if (self.isActive) {
            const TAU = Math.PI * 2;
            gsap.to(state.dragOffset, {
              x: 0, y: Math.round(state.dragOffset.y / TAU) * TAU,
              duration: 1.2, ease: 'power3.inOut', overwrite: 'auto',
            });
          }
        },
      });
    // 手动切换按钮（RM 专属）
    $$('.pose-switch button').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const pose = [D.A, D.B, D.C][i];
        setPose(pose, i === 2 ? 1 : 0);
        state.detailsSeg = i;
        C.hotspots.forEach((h) => hotspotEls[h.id] && hotspotEls[h.id].classList.toggle('is-active', h.seg === i));
        $$('.pose-switch button').forEach((b, j) => b.classList.toggle('is-on', i === j));
      });
    });
    setCaptions(1);
  }

  /* ================= 章节圆点导航 / 进度条 / 锚点 ================= */
  const dotBtns = $$('.dots button');
  const secIds = ['hero', 'gallery', 'details', 'specs', 'cta'];
  secIds.forEach((id, i) => {
    ScrollTrigger.create({
      trigger: `#${id}`, start: 'top center', end: 'bottom center',
      onToggle(self) {
        if (self.isActive) {
          dotBtns.forEach((b, j) => b.classList.toggle('is-active', i === j));
        }
      },
    });
  });

  const barI = $('.progress-bar i');
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate(self) { if (barI) barI.style.transform = `scaleX(${self.progress})`; },
  });

  function scrollToTarget(sel) {
    const el = $(sel);
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 3) });
    else el.scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
  }
  $$('.site-nav a, .dots button, a.brand').forEach((el) => {
    el.addEventListener('click', (e) => {
      const t = el.getAttribute('href') || el.dataset.target;
      if (t && t.startsWith('#')) { e.preventDefault(); scrollToTarget(t); }
    });
  });
  const toTop = $('.to-top');
  if (toTop) {
    toTop.addEventListener('click', () => {
      // 返回顶部 = 重播整段旅程（滚动状态全部可逆）
      if (lenis) lenis.scrollTo(0, { duration: 2.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  const ctaBtn = $('.cta-btn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', () => {
      gsap.fromTo(ctaBtn, { scale: 0.95 }, { scale: 1, duration: DUR.fast, ease: 'elastic.out(1, 0.45)' });
    });
  }

  // 滚动后隐藏下滑提示
  const onScrollHint = () => document.body.classList.toggle('is-scrolled', window.scrollY > 60);
  window.addEventListener('scroll', onScrollHint, { passive: true });

  /* ================= 幕 5：数据卡片 / 数字滚动 / 轻量图表 ================= */
  function initSpecsUI() {
    try {
      const grid = $('.spec-grid');
      if (!grid) return;
      C.specs.cards.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'spec-card';
        card.style.setProperty('--depth', (i % 3) * 0.5 + (i % 2 ? 0.8 : 0.2));
        card.innerHTML = `
          <div class="spec-num"><span class="spec-prefix mono">${c.prefix || ''}</span><span class="spec-val">0</span></div>
          <div class="spec-unit mono">${c.unit}</div>
          <div class="spec-label">${c.label}</div>`;
        grid.appendChild(card);

        // 数字滚动 count-up
        const valEl = card.querySelector('.spec-val');
        ScrollTrigger.create({
          trigger: card, start: 'top 88%', once: true,
          onEnter: () => {
            const obj = { v: 0 };
            gsap.to(obj, {
              v: c.v, duration: 1.6, ease: 'power2.out',
              onUpdate: () => {
                valEl.textContent = c.dec > 0
                  ? obj.v.toFixed(c.dec)
                  : Math.round(obj.v).toLocaleString('en-US');
              },
            });
          },
        });
        // 入场浮现
        gsap.fromTo(card,
          { y: 48, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: DUR.base, ease: EASE.out, scrollTrigger: { trigger: card, start: 'top 92%', once: true } });
        // 分层视差：不同 --depth 深浅不一地浮动
        if (!RM) {
          gsap.to(card, {
            yPercent: -8 * parseFloat(card.style.getPropertyValue('--depth')),
            ease: 'none',
            scrollTrigger: { trigger: '#specs', start: 'top bottom', end: 'bottom top', scrub: 1 },
          });
        }
      });

      // 雷达图 + 折线图（原生 canvas 2D，轻量无依赖）
      const radar = $('#radar'); const spark = $('#spark');
      const prep = (cv) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = cv.clientWidth, h = cv.clientHeight;
        cv.width = w * dpr; cv.height = h * dpr;
        const g = cv.getContext('2d');
        g.scale(dpr, dpr);
        return { g, w, h };
      };

      function drawRadar(p) {
        const { g, w, h } = prep(radar);
        const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) * 0.34;
        const n = C.specs.radar.axes.length;
        const pt = (i, r) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        };
        g.strokeStyle = 'rgba(200,204,212,0.1)';
        g.lineWidth = 1;
        [0.33, 0.66, 1].forEach((k) => {
          g.beginPath();
          for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, R * k); i ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke();
        });
        for (let i = 0; i < n; i++) {
          const [x, y] = pt(i, R);
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
          const [lx, ly] = pt(i, R + 16);
          g.fillStyle = 'rgba(200,204,212,0.55)';
          g.font = '10px "JetBrains Mono", monospace';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(C.specs.radar.axes[i], lx, ly);
        }
        const e = 1 - Math.pow(1 - p, 3);
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const [x, y] = pt(i % n, R * C.specs.radar.values[i % n] * e);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath();
        g.fillStyle = 'rgba(61,126,159,0.18)'; g.fill();
        g.strokeStyle = '#3d7e9f'; g.lineWidth = 1.5; g.stroke();
        for (let i = 0; i < n; i++) {
          const [x, y] = pt(i, R * C.specs.radar.values[i] * e);
          g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2);
          g.fillStyle = '#c8ccd4'; g.fill();
        }
      }

      function drawSpark(p) {
        const { g, w, h } = prep(spark);
        const vals = C.specs.spark.values;
        const pad = 14;
        // 纵轴范围随数据自适应（冲击吸收率 / 误差值等不同量纲通用）
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const span = (hi - lo) || 1;
        const min = lo - span * 0.18, max = hi + span * 0.18;
        const X = (i) => pad + (i / (vals.length - 1)) * (w - pad * 2);
        const Y = (v) => h / 2 - ((v - min) / (max - min)) * (h - pad * 2);
        // 零轴（仅当数据跨越 0 时绘制）
        if (min < 0 && max > 0) {
          g.strokeStyle = 'rgba(200,204,212,0.14)'; g.setLineDash([3, 5]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.stroke();
          g.setLineDash([]);
        }
        // 面积（双色线性渐变）
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(61,126,159,0.22)');
        grad.addColorStop(1, 'rgba(61,126,159,0)');
        g.save();
        g.beginPath(); g.rect(0, 0, (w) * p, h); g.clip();
        g.beginPath();
        g.moveTo(X(0), Y(0));
        vals.forEach((v, i) => g.lineTo(X(i), Y(v)));
        g.lineTo(X(vals.length - 1), Y(0));
        g.closePath();
        g.fillStyle = grad; g.fill();
        // 折线
        g.beginPath();
        vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.strokeStyle = '#3d7e9f'; g.lineWidth = 1.6; g.stroke();
        g.restore();
        const li = Math.max(0, Math.min(vals.length - 1, Math.floor((vals.length - 1) * p)));
        g.beginPath(); g.arc(X(li), Y(vals[li]), 3, 0, Math.PI * 2);
        g.fillStyle = '#c8ccd4'; g.fill();
      }

      ScrollTrigger.create({
        trigger: '.charts', start: 'top 82%', once: true,
        onEnter: () => {
          const o1 = { p: 0 }, o2 = { p: 0 };
          gsap.to(o1, { p: 1, duration: DUR.slow, ease: EASE.out, onUpdate: () => drawRadar(o1.p) });
          gsap.to(o2, { p: 1, duration: DUR.slow, ease: EASE.out, delay: 0.15, onUpdate: () => drawSpark(o2.p) });
        },
      });
      // resize 重绘
      window.addEventListener('resize', () => {
        if (radar && radar.clientWidth) drawRadar(1);
        if (spark && spark.clientWidth) drawSpark(1);
      });
    } catch (e) {
      console.warn('[interactions] 数据幕初始化失败：', e);
    }
  }
  initSpecsUI();

  /* ================= 幕 6 文案浮现 ================= */
  if (!RM) {
    gsap.fromTo('#cta [data-reveal]',
      { y: 44, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: DUR.slow, ease: EASE.out, stagger: 0.1,
        scrollTrigger: { trigger: '#cta', start: 'top 55%', once: true } });
  }

  /* ================= 每帧更新 ================= */
  const spot = sceneApi.lights.cursorSpot;
  const spotTarget = sceneApi.lights.cursorTarget;
  const glow = sceneApi.volumetrics.glowSprite;
  const hoverTargetRot = { x: 0, y: 0 };
  const zoomV = new THREE.Vector3();

  function updatePointerWorld() {
    ndc.set(pointer.nx, pointer.ny);
    raycaster.setFromCamera(ndc, camera);
    const dir = raycaster.ray.direction;
    const denom = dir.z || -1e-6;
    const t = -raycaster.ray.origin.z / denom;
    if (t > 0) pointer.world.copy(raycaster.ray.origin).addScaledVector(dir, t);
  }

  function updateHover() {
    if (!refs.current) { pointer.hovering = false; return; }
    raycaster.setFromCamera(ndc, camera);
    refs.current.floatGroup.getWorldPosition(dragSphere.center);
    dragSphere.radius = (refs.current.radius || 1.3) + 0.25;
    pointer.hovering = raycaster.ray.intersectsSphere(dragSphere) && !state.ctaProgress;
  }

  function update(dt, t) {
    const m = C.parallax;
    const k = Math.min(1, dt * 60);

    // 1) 指针世界坐标 + hover 检测
    updatePointerWorld();
    updateHover();

    // 2) 视差 lerp（拖拽时让位归零，避免视差与拖拽旋转打架；RM 关闭）
    const activeNx = state.dragging ? 0 : pointer.nx;
    const activeNy = state.dragging ? 0 : pointer.ny;
    const pl = RM ? 0 : m.lerp;
    par.nx += (activeNx - par.nx) * pl * k * 1.2;
    par.ny += (activeNy - par.ny) * pl * k * 1.2;

    // 3) 相机 = rig 机位沿视线方向缩放（滚轮/捏合）+ 鼠标视差（分层）
    state.zoom += (state.zoomTarget - state.zoom) * Math.min(1, dt * C.zoom.lerp);
    zoomV.copy(rig.pos).sub(rig.target).multiplyScalar(1 / state.zoom);
    camera.position.copy(rig.target).add(zoomV);
    camera.position.x += par.nx * m.camera;
    camera.position.y += par.ny * m.cameraY;
    tmpTarget.copy(rig.target);
    tmpTarget.x += par.nx * m.look;
    tmpTarget.y += par.ny * m.look * 0.6;
    camera.lookAt(tmpTarget);

    if (refs.current) {
      const { modelRoot, floatGroup, spinGroup } = refs.current;

      // 模型就绪后落到螺旋起点（柱右侧），等待滚动进入绕柱螺旋
      if (!spiralInit) {
        modelRoot.position.copy(spiralAt(0));
        spiralInit = true;
      }

      // 4) 磁悬浮展示：持续自转（转转转）+ 上下轻浮动；拖拽中暂停自转，松手 3s 后恢复
      if (!RM) {
        if (!state.dragging && !state.detailsActive) {
          if (state.idleCountdown > 0) state.idleCountdown -= dt;
          else state.idleSpin += C.model.idleSpinSpeed * dt;
        }
        floatGroup.position.y = Math.sin(t * C.model.float.speed) * C.model.float.amp;
        // 视差旋转 ±3°（相机微动，非模型位移）
        hoverTargetRot.x = activeNy * THREE.MathUtils.degToRad(m.modelDeg);
        hoverTargetRot.y = activeNx * THREE.MathUtils.degToRad(m.modelDeg);
        floatGroup.rotation.x += (hoverTargetRot.x - floatGroup.rotation.x) * 0.06 * k;
        floatGroup.rotation.y += (hoverTargetRot.y - floatGroup.rotation.y) * 0.06 * k;
      }

      // 5) 拖拽：松手后轻微惯性、逐渐停下；不回弹，保持用户转到的角度
      if (!state.dragging && Math.abs(state.dragVel) > 1e-4) {
        state.dragOffset.y += state.dragVel;
        state.dragVel *= Math.exp(-dt * C.drag.inertiaDecay);
      }

      // 6) 姿态合成：展台自转 + 拖拽偏移 + 入场轻微转身（绝对量合成，scrub 可逆）
      spinGroup.rotation.x = state.dragOffset.x;
      spinGroup.rotation.y = state.idleSpin + state.scrollSpin + state.dragOffset.y + state.introSpin;

      // 10) DOF 焦点跟随模型
      pointer.modelCenter.copy(modelRoot.position);
    }

    // 8) 聚光灯光斑跟随光标
    if (!RM && spot) {
      spotTarget.position.lerp(pointer.world, 0.12 * k);
      spot.position.set(pointer.world.x, pointer.world.y + 3.2, pointer.world.z + 2.6);
      const ti = pointer.hovering ? C.lights.cursorSpot.intensityHover : C.lights.cursorSpot.intensityIdle;
      spot.intensity += (ti - spot.intensity) * 0.08 * k;
      if (glow) {
        glow.position.lerp(new THREE.Vector3(pointer.world.x, pointer.world.y, pointer.world.z + 0.6), 0.14 * k);
        const go = (pointer.hovering ? 0.22 : 0.05) + state.ctaProgress * 0.2;
        glow.material.opacity += (go - glow.material.opacity) * 0.08 * k;
      }
    }

    // 9) 光标 DOM
    if (cursorEl) {
      cur.x += (pointer.px - cur.x) * C.cursor.dotLerp * k * 1.4;
      cur.y += (pointer.py - cur.y) * C.cursor.dotLerp * k * 1.4;
      cur.rx += (pointer.px - cur.rx) * C.cursor.ringLerp * k * 1.4;
      cur.ry += (pointer.py - cur.ry) * C.cursor.ringLerp * k * 1.4;
      curDot.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      curRing.style.transform = `translate3d(${cur.rx}px, ${cur.ry}px, 0) scale(${pointer.hovering ? C.cursor.hoverScale : 1})`;
      curLabel.style.transform = `translate3d(${cur.rx + 22}px, ${cur.ry + 24}px, 0)`;
      const label = state.dragging ? '●' : pointer.hovering ? (state.detailsActive ? C.cursor.labelView : C.cursor.labelDrag) : '';
      if (curLabel.textContent !== label) curLabel.textContent = label;
      cursorEl.classList.toggle('is-hover', pointer.hovering || !!label);
    }

    // 11) 部件标签投影到屏幕（HTML overlay 跟随 3D 锚点）
    if (state.detailsActive && refs.current) {
      const w = window.innerWidth, h = window.innerHeight;
      refs.current.anchors.forEach(({ obj, id }) => {
        const el = hotspotEls[id];
        if (!el) return;
        obj.getWorldPosition(tmpPos);
        tmpPos.project(camera);
        const behind = tmpPos.z > 1;
        const x = (tmpPos.x * 0.5 + 0.5) * w;
        const y = (-tmpPos.y * 0.5 + 0.5) * h;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        el.style.opacity = behind ? 0 : '';
      });
    }
  }

  return { update, lenis, state };
}
