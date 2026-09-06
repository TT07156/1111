/**
 * effects.js — 后处理链（Bloom / DOF / 色差 / 颗粒 / 暗角）+ 自定义着色器星尘粒子
 * 提供统一的 update / resize / degrade（性能降级）接口。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';

/* ---------------- 调色 Pass：轻微色差 + 胶片颗粒 + 暗角（合并为一个 Pass，省一遍全屏采样） ---------------- */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: CONFIG.post.grade.aberration },
    uGrain: { value: CONFIG.post.grade.grain },
    uVignette: { value: CONFIG.post.grade.vignette },
    uVStart: { value: CONFIG.post.grade.vignetteStart },
    uVEnd: { value: CONFIG.post.grade.vignetteEnd },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uGrain, uVignette, uVStart, uVEnd;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);

      // 轻微径向色差：RGB 三通道沿半径方向错位采样
      vec2 off = c * d * uAberration * 2.0;
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, g, b);

      // 动态胶片颗粒
      float n = hash(vUv * vec2(1919.0, 1080.0) + fract(uTime) * 61.7) - 0.5;
      col += n * uGrain;

      // 暗角
      float l = length(c) * 1.414;
      col *= 1.0 - smoothstep(uVStart, uVEnd, l) * uVignette;

      gl_FragColor = vec4(col, 1.0);
    }`,
};

/* ---------------- 星尘粒子：THREE.Points + 自定义着色器（漂移 / 鼠标斥力 / 幕6向光收拢） ---------------- */
const ParticlesVert = /* glsl */`
  uniform float uTime, uSize, uPixelRatio, uRepel, uConverge, uMotion;
  uniform vec2 uParallax;
  uniform vec3 uMouse;
  attribute float aScale;
  attribute vec3 aSeed;
  varying float vAlpha;
  varying float vMix;

  void main() {
    vec3 p = position;
    float t = uTime * uMotion;

    // 慢速漂移（各粒子相位由 seed 决定）
    p.x += sin(t * 0.12 + aSeed.x * 6.2831) * ${CONFIG.particles.driftAmp} * aSeed.y;
    p.y += sin(t * 0.10 + aSeed.y * 6.2831) * 0.5 * aSeed.z;
    p.z += cos(t * 0.09 + aSeed.z * 6.2831) * 0.6 * aSeed.x;

    // 鼠标斥力：靠近 uMouse 的粒子被推开
    vec3 dir = p - uMouse;
    float dist = length(dir);
    p += normalize(dir + 0.0001) * smoothstep(${CONFIG.particles.repelRadius}, 0.0, dist) * uRepel;

    // 幕 6：粒子向光收拢（每粒子随机延迟）
    vec3 home = vec3(0.0, 0.55, 0.0)
      + vec3(sin(aSeed.x * 41.0), cos(aSeed.y * 33.0), sin(aSeed.z * 27.0)) * 0.32;
    p = mix(p, home, uConverge * (0.35 + 0.65 * aSeed.y));

    // 背景层视差：与相机层反向、幅度不同 → 分层景深
    p.xy += uParallax * 0.55 * (0.4 + aSeed.z);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.55 + 0.45 * sin(t * (0.5 + aSeed.x) + aSeed.y * 6.28);
    vAlpha = twinkle * smoothstep(30.0, 6.0, -mv.z) * smoothstep(1.2, 3.4, -mv.z);
    vMix = aSeed.z;
    gl_PointSize = uSize * aScale * uPixelRatio * (150.0 / max(0.001, -mv.z));
  }`;

const ParticlesFrag = /* glsl */`
  uniform vec3 uColorA, uColorB;
  varying float vAlpha;
  varying float vMix;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.06, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColorA, uColorB, vMix), a);
  }`;

export function createEffects(renderer, scene, camera) {
  const C = CONFIG;
  const isMobile = C.runtime.isMobile;

  /* ---------------- 粒子系统 ---------------- */
  const count = isMobile ? C.particles.countMobile : C.particles.countDesktop;
  const maxCount = count;
  const positions = new Float32Array(maxCount * 3);
  const seeds = new Float32Array(maxCount * 3);
  const scales = new Float32Array(maxCount);
  for (let i = 0; i < maxCount; i++) {
    // 分布在包围模型的球壳内，避开核心区
    const r = 4.5 + Math.pow(Math.random(), 0.7) * 11;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(ph) * Math.cos(th);
    positions[i * 3 + 1] = (r * Math.sin(ph) * Math.sin(th)) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(ph) * 0.8 - 1.5;
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
    scales[i] = 0.4 + Math.random() * 1.1;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  pGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

  const pUniforms = {
    uTime: { value: 0 },
    uSize: { value: C.particles.size },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uMotion: { value: C.runtime.reducedMotion ? 0 : 1 }, // reduced-motion 时星尘静止
    uRepel: { value: C.particles.repelStrength },
    uConverge: { value: 0 },
    uParallax: { value: new THREE.Vector2(0, 0) },
    uMouse: { value: new THREE.Vector3(99, 99, 99) },
    uColorA: { value: new THREE.Color(C.particles.colorA) },
    uColorB: { value: new THREE.Color(C.particles.colorB) },
  };
  const points = new THREE.Points(pGeo, new THREE.ShaderMaterial({
    uniforms: pUniforms,
    vertexShader: ParticlesVert,
    fragmentShader: ParticlesFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);

  /** 性能降级：粒子数量减半（drawRange 实现，零重建成本） */
  function halveParticles() {
    pGeo.setDrawRange(0, Math.floor(maxCount / 2));
  }

  /* ---------------- 后处理链 ---------------- */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    C.post.bloom.strength, C.post.bloom.radius, C.post.bloom.threshold
  );
  const bokehPass = new BokehPass(scene, camera, {
    focus: 7.4,
    aperture: C.post.dof.aperture,
    maxblur: C.post.dof.maxblur,
  });
  const gradePass = new ShaderPass(GradeShader);
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bokehPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(gradePass); // 调色放在 OutputPass 之后，作用于最终 sRGB 画面

  // BokehPass 的深度预渲染会把加色元素（光锥/光晕/舞台）也写进深度图造成模糊伪影，
  // 这里在深度渲染期间临时隐藏它们。
  const noDepth = [];
  scene.traverse((o) => {
    if (o.isSprite || (o.isMesh && o.material && o.material.blending === THREE.AdditiveBlending)) noDepth.push(o);
  });
  const origBokehRender = bokehPass.render.bind(bokehPass);
  bokehPass.render = (...args) => {
    const vis = noDepth.map((o) => o.visible);
    noDepth.forEach((o) => (o.visible = false));
    origBokehRender(...args);
    noDepth.forEach((o, i) => (o.visible = vis[i]));
  };

  /* ---------------- 对外接口 ---------------- */
  const focusTarget = new THREE.Vector3();
  let currentFocus = 7.4;

  function update(dt, elapsed, pointer) {
    gradePass.uniforms.uTime.value = elapsed;
    pUniforms.uTime.value = elapsed;
    pUniforms.uMouse.value.lerp(pointer.world, 0.2);
    pUniforms.uParallax.value.set(
      -pointer.nx * C.parallax.particles,
      pointer.ny * C.parallax.particles
    );

    // 景深焦点：平滑跟随模型中心距离（背景自然虚化）
    focusTarget.copy(pointer.modelCenter);
    const dist = camera.position.distanceTo(focusTarget) + C.post.dof.focusOffset;
    currentFocus += (dist - currentFocus) * C.post.dof.focusLerp;
    bokehPass.uniforms['focus'].value = currentFocus;
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    composer.setSize(w, h);
    pUniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  /** 连续低帧率时的自动降级：关 Bloom / 关 DOF / 粒子减半 / 压像素比 */
  function degrade(onPixelRatioDrop) {
    bloomPass.enabled = false;
    bokehPass.enabled = false;
    halveParticles();
    bloomPass.strength = 0;
    console.warn('[effects] 帧率持续低于阈值 → 已关闭 Bloom / DOF，粒子数量减半');
    if (onPixelRatioDrop) onPixelRatioDrop();
  }

  return {
    composer, bloomPass, bokehPass, gradePass, points, pUniforms,
    update, onResize, degrade, halveParticles,
    setConverge: (v) => (pUniforms.uConverge.value = v),
    setPixelRatioSync: () => {
      composer.setPixelRatio(renderer.getPixelRatio());
      pUniforms.uPixelRatio.value = renderer.getPixelRatio();
    },
  };
}
