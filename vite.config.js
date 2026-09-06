import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，构建产物可在任意静态目录直接打开
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    open: false,
    port: 5173,
  },
});
