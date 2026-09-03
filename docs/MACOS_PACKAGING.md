# macOS 本地预览打包

## 当前目标

`pnpm package:mac` 在 Apple Silicon Mac 上生成 ARM64 DMG 和 ZIP。Electron 应用通过
`electron-builder` 组装，Python 文档引擎通过 GPLv2-or-later（含允许分发生成程序的特殊例外）
的 PyInstaller 生成单文件 sidecar。sidecar 的 Python、PyInstaller、python-docx、Pillow 和 lxml 版本，以及可执行文件
SHA-256，会写入应用资源目录中的 `sidecar/build-manifest.json`。

## 依赖边界

安装包只包含应用代码、可公开分发的模板包、本地 Python sidecar 和公开的远程服务配置。
它不会复制或打包本机文档字体、TeX Live、XeLaTeX、latexmk、Poppler、学生数据、导出文件、
签名材料或开发环境路径。Word/PDF/LaTeX 的正式渲染继续依赖首次启动检查发现的本机环境。
应用界面的开源 Geist Web 字体属于前端资源，不用于正式文档排版。

## 构建与验证

```bash
pnpm package:mac
```

该命令执行源码 lint、测试和构建，生成并冒烟测试 sidecar，创建图标，最后在 `release/`
写出 DMG、ZIP 与未压缩 `.app`。`release/` 被 Git 忽略，不应提交二进制产物。

当前构建显式设置 `identity: null`，没有 Apple Developer ID 签名或公证。安装包仅作为本地
预览件；公开发布前仍需单独完成签名、公证、Gatekeeper、升级回滚、全新机器和 Word/WPS 验收。
