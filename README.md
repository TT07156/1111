# LUMEN · ÉCLIPSE ONE — 沉浸式 3D 产品展示厅

Awwwards 风格的单页 3D showroom：暗黑质感、电影级运镜、全程鼠标/滚动交互反馈。
展品模型放在 `public/models/product.glb`（当前为手机壳示例）；加载后会自动居中、
扶正（最薄面朝相机）并按相机 fov 自动取景（占屏高 ≤ 60%，任何幕不裁切）。
`npm run model` 可重新生成旧的示例腕表模型。

## 快速开始

```bash
npm install        # 安装依赖（three / gsap / lenis / fontsource / vite）
npm run model      # 重新生成 product.glb（可选，已预生成）
npm run dev        # 开发模式  → http://localhost:5173
npm run build      # 构建到 dist/
npm run preview    # 预览构建产物 → http://localhost:4173
```

## 目录结构

```
index.html               页面结构（6 幕 + 加载页 + 光标 + 降级页）
src/main.js              入口：初始化、渲染循环、帧率监控、加载页/入场编排
src/scene.js             场景、灯光、RoomEnvironment 环境反射、模型加载与归一化
src/effects.js           后处理链（Bloom/DOF/色差/颗粒/暗角）+ 着色器星尘粒子
src/interactions.js      鼠标视差、拖拽、滚动驱动运镜、自定义光标、数据幕
src/config.js            CONFIG：所有颜色/强度/时长/曲线/机位/阈值集中于此
src/style.css            全站样式（颜色变量由 config.js 注入）
public/models/product.glb   展品模型（GLTFLoader + DRACOLoader 加载）
public/draco/            Draco 本地解码器（无 CDN 依赖）
scripts/build-model.mjs  程序化建模脚本（three + GLTFExporter，Node 运行）
```

## 六幕结构

| 幕 | 内容 | 交互反馈 |
|---|---|---|
| 1 加载页 | LoadingManager 进度条 + 百分比 + 品牌逐字浮现 + 光晕呼吸 | 初始化自定义光标 |
| 2 Hero | 模型 expo 弹入 + 超大标题逐行 reveal | 鼠标视差 ±3°、聚光灯光斑跟随、粒子鼠标斥力 |
| 3 展厅（pin） | 摄像机沿 CatmullRom 曲线推近 + 自转绑定滚动（scrub:1） | 图注按进度切换、KEEP SCROLLING 百分比 |
| 4 细节（pin） | 三机位：正面 0° / 45° 半侧 / 局部特写 | HTML 标签世界坐标投影跟随、拖拽微调（带回弹）、特写金属反射增强 |
| 5 参数 | 数字 count-up + 雷达图/误差折线（原生 canvas） | 卡片分层视差、右侧圆点章节导航 |
| 6 CTA | 模型淡出 + 粒子向光收拢 | CTA/页脚滑入、返回顶部重播全程 |

## 性能与降级（验收项）

- 像素比 clamp：桌面 ≤2，移动 ≤1.5
- `visibilitychange` 隐藏时暂停渲染循环
- 连续 2 秒 < 30 FPS → 自动关闭 Bloom/DOF + 粒子减半 + 压低像素比
- WebGL 不可用 → 静态渐变背景 + 占位图 + 文字说明（绝不白屏）
- 模型缺失/加载失败 → 占位球体 + `console.warn`（测试钩子：`?fallback=1`）
- `prefers-reduced-motion` → 关闭运镜/pin，静态展示 + 手动切换机位按钮
- 移动端：touch 拖拽替代 mousemove、粒子减半、窄屏自动增大 FOV

## 调试钩子

控制台可用 `window.__showroom`：`lenis` / `degrade()` / `scene` / `effects` / `ScrollTrigger`。
