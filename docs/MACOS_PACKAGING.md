# macOS 本地预览打包

## 当前目标

`pnpm package:mac` 在 Apple Silicon Mac 上生成 ARM64 DMG 和 ZIP。Electron 应用通过
`electron-builder` 组装，Python 文档引擎通过 GPLv2-or-later（含允许分发生成程序的特殊例外）
的 PyInstaller 生成单文件 sidecar。sidecar 的 Python、PyInstaller、python-docx、Pillow 和 lxml 版本，以及可执行文件
SHA-256，会写入应用资源目录中的 `sidecar/build-manifest.json`。

## 依赖边界

安装包只包含应用代码、经过逐文件允许清单与 SHA-256 复核的过程文档模板引擎、本地 Python sidecar 和公开的远程服务配置。
它不会复制或打包本机文档字体、TeX Live、XeLaTeX、latexmk、Poppler、学生数据、导出文件、
签名材料或开发环境路径。Word/PDF/LaTeX 的正式渲染继续依赖首次启动检查发现的本机环境。
应用界面的开源 Geist Web 字体属于前端资源，不用于正式文档排版。

模板引擎来自 `SZTU_DOCS_PACKAGING_TEMPLATE_ROOT` 指向的受信任本地模板工程；未设置时只在
开发者相邻的 `Thesis` 检出中查找。打包脚本仅复制三类过程文档渲染所需的精确文件，不复制
fixture、历史样例、参考材料或 `fonts.local`。三份官方模板的公开发布授权已由项目维护者确认；
打包阶段只在 `build/bundled-template-engines/` 暂存副本中删除作者、最后修改者、创建/修改/打印时间、
公司/应用标识和自定义属性，绝不回写相邻的受信任 `Thesis` 源模板检出。清理后的暂存副本使用
`public-release-authorized` 与 `public-release-scrubbed-v1` 标记，逐文件 SHA-256、模板包身份及版本号
均基于清理后的字节计算。相同源模板应生成字节一致的清理副本。

## 构建与验证

```bash
pnpm package:mac
```

该命令执行源码 lint、测试和构建，生成并冒烟测试 sidecar，创建图标，最后在 `release/`
写出 DMG、ZIP 与未压缩 `.app`。`release/` 被 Git 忽略，不应提交二进制产物。

Finder 启动不会继承终端的完整 `PATH`。主进程会为 sidecar 补入 macOS 的标准 TeX、Homebrew、
MacPorts 与 `/usr/local` 工具目录，使环境检查和实际渲染使用同一套搜索路径。

桌面端的 React、Tiptap、Tailwind 和其他界面依赖只参与 Vite 构建，不作为 Node.js 运行时依赖
重复进入 `.app`。打包后会运行 `scripts/verify_macos_app_bundle.mjs`，拒绝包含运行时
`node_modules`、非中英文 Electron 语言资源、文档字体或开发机路径的安装包。macOS 包仅保留
`zh_CN` 与 `en` 两种 Electron 语言资源。

当前构建显式设置 `identity: "-"`，对整个应用包做 ad-hoc 签名并在打包后检查签名完整性。
它没有 Apple Developer ID 签名或公证；从网络下载后，Gatekeeper 仍可能拦截，
需要用户在“系统设置 → 隐私与安全性”手动允许可信来源的应用。Ed25519 清单、文件长度与 SHA-256 只验证下载完整性，
不等同于 Apple 平台签名、公证、自动安装、升级回滚、全新机器或 Word/WPS 验收。

若系统仍提示应用“已损坏”，先核对下载文件与签名清单中的 SHA-256，并运行
`hdiutil verify` 确认 DMG 完整。仅在确认该文件确实来自本项目后，可对已安装的这份应用
执行 `xattr -dr com.apple.quarantine "/Applications/SZTU文档工作台.app"`，再从“应用程序”打开。
这只解除本机的下载隔离标记，不会给应用补上 Apple Developer ID 签名或公证。
