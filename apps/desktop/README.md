# Desktop application

Electron 主进程、安全 preload 与 React renderer 位于本目录。界面仅组合官方 CLI 生成的默认 `shadcn/ui` 组件；安全边界与禁止自定义前端的规则见仓库根目录 `AGENTS.md`。

颜色、字体、文字层级和自动防漂移规则见 [前端设计系统使用规范](../../docs/FRONTEND_DESIGN_SYSTEM.md)。

开发态为保持严格 CSP，Vite HMR 已关闭；修改 renderer 后重新加载窗口即可。正式构建不依赖开发服务器。
