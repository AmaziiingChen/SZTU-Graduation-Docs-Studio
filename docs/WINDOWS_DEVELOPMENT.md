# Windows 开发与打包

2026-10-04 已在 Windows x64 上构建本地 0.1.5 离线安装包，并整合 macOS 工作台新功能。使用同一套 Electron + React + TypeScript 前端和 Python 文档引擎。常规打包入口为 `pnpm package:win`；内置 TeX/Poppler 的离线版使用 `pnpm package:win:offline`。

## 当前工作区

```text
C:\AmazingSyncthing\Thesis\
  SZTU-Graduation-Docs-Studio\  应用仓库
  Thesis\                       配套模板仓库
```

应用与模板均在 `codex/thesis-workbench` 分支，当前基线分别为 `c4ac639`、`8b541eb`，并保留本地 Windows 适配。应用开发态自动读取同级 `../Thesis`，验证允许清单并生成不可变快照。安装包准备开题报告、任务书、中期检查、指导教师评审、评阅人评审、答辩记录和成绩考核七类引擎。

最新源码已同步编辑器一键整理、连续列表编号、进度展开编辑与撤销、评审题目富文本以及溢出字段定位。本轮只完成本地合并、检查和构建，使用 `pnpm dev` 查看；现有 0.1.5 安装包仍对应上一轮构建。详细结果见 [本轮源码同步记录](evidence/REMOTE_SYNC_20261004.md)。

毕业论文页面提供内置 LaTeX 源码工程下载，不依赖 Python/TeX 即可保存 ZIP。独立编译按包内 README 准备环境。工作台环境检查已改为校验实际内置源码包的完整性，不再检查已不用于该页面的旧 `thesis_engine`。

本轮共用功能包含学生档案布局与学号辅助识别、四类评审表、保存后关闭/退出、独立控制与渲染进程、文档分页及论文源码下载。Windows 专项修复包括开发入口的 pnpm 调用方式、原生命令日志解码、UTF-8 输入和保留文件名兼容；相关修复继续留在共用模块中。

## 日常开发

2026-10-04 本机通用工具已核对：Node.js 24.14.1、Python 3.14.3、Git、GitHub CLI、VS Code、uv 和 7-Zip 已有；已通过 WinGet 为当前用户补装 ripgrep 15.2.0、fd 10.5.0 和 jq 1.8.2。VS Code 已补装 Tailwind CSS IntelliSense 和 Oxlint 扩展，Python/Pylance 原已安装。安装后重新打开 PowerShell，使用户 PATH 生效。

本项目由 Corepack 按 `packageManager` 字段选择 pnpm 11.19.0。首次出现下载确认，表示正在准备指定 pnpm 版本；本机已执行 `corepack install` 缓存该版本，并验证 `pnpm install --frozen-lockfile`、Electron 和私有 Python 环境。不同项目可以使用不同 pnpm 版本，无需为了该提示重装 Node.js。

需要 Node.js 24、pnpm 11.19.0、Python 3.11+。本机实测版本为 Node.js 24.14.1 和 Python 3.14.3。分页预览/PDF 还使用本机 TeX Live 和 Poppler；Word/WPS 用于最终文档验收。

在应用目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm setup:backend
pnpm dev
```

Python 依赖位于 `.venv\Scripts\python.exe`。macOS 与 Windows 分别准备自己的 `node_modules`、`.venv` 和构建产物；这些平台二进制不作为跨系统共享的开发环境。代码与模板源文件可以共享。

当前开发态关闭了 HMR。修改 renderer 或 Electron 代码后重启开发进程；修改 Python 运行逻辑后也应退出应用并重新启动。关闭窗口可能只是隐藏到托盘，请使用托盘菜单退出。

```powershell
pnpm verify
```

该命令覆盖 lint、桌面测试、遥测管理端测试、更新工具测试、Python 测试及两个前端构建。Word/WPS 逐页人工验收是独立步骤。

新建模板检出时保留 LF，避免 Windows 的 Git 换行转换改变模板内容指纹：

```powershell
git -c core.autocrlf=false clone --branch codex/thesis-workbench --single-branch https://github.com/AmaziiingChen/SZTU-Thesis-Latex-Template.git Thesis
```

如果使用其他位置的模板工程，可以在应用内关联，或指定绝对路径：

```powershell
$env:SZTU_DOCS_PROPOSAL_ENGINE_DIR = 'D:\Projects\Thesis'
$env:SZTU_DOCS_TASK_BOOK_ENGINE_DIR = 'D:\Projects\Thesis'
$env:SZTU_DOCS_MIDTERM_ENGINE_DIR = 'D:\Projects\Thesis'
pnpm dev
```

## Windows 安装包

```powershell
pnpm package:win
```

该入口准备私有 Python 环境和 PyInstaller，运行完整校验，构建 Windows Python 可执行文件，准备三个模板引擎和 ICO 图标，再生成 NSIS 安装包并核验解包目录。

产物：

- `release/SZTU-Docs-Studio-<版本>-win-x64.exe`：常规版的当前用户安装包。
- `release/win-unpacked/SZTU-Docs-Studio.exe`：解包版启动入口；须保留整个 `win-unpacked` 目录。
- `release/win-unpacked/resources/sidecar/sztu-docs-backend.exe`：内置 Python 引擎，最终用户无需安装 Python。

常规安装包依赖目标机器上的 TeX、Poppler 和合法文档字体。当前包没有 Windows 代码签名，尚未完成安装/卸载与目标编辑器人工验收；本次没有上传或公开发布。

## 离线安装包：分享给 Windows 使用者

分享 `release/offline/SZTU-Docs-Studio-0.1.5-win-x64-offline.exe`（约 358 MiB）。用户双击安装，应用自动优先使用 `resources/offline-runtime` 中的工具；无需单独安装 Node.js、Python、TeX Live 或 Poppler，无需修改系统 PATH，无需联网下载宏包。

离线版包含 TeX Live 2025 的 176 个所需宏包及其依赖、XeLaTeX、BibTeX、latexmk/Perl 和 Poppler 26.09.0；保留相关许可、可用宏包源文件及 Poppler 源码归档。TeX Live 的开源字体随其包保留，Windows/Office 商业文档字体不进入安装包。

**使用英文安装路径。** 默认目录采用 `SZTU Docs Studio`，中文桌面快捷方式和应用名称保留。TeX 在中文路径下仍有底层兼容限制；如果 Windows 用户名含中文，请在安装时选择如 `D:\SZTU-Docs-Studio` 的全英文路径。含空格的英文目录移动后已通过宏包、工具和中文 PDF 测试。应用为 TeX 启动器设置当前运行根目录，并在可用时使用 Windows 短路径；不更改系统语言或安全设置。

仍需本机合法文档字体和 Word/WPS。方正小标宋简体仅用于中期检查表的两行 18 pt 大标题，当前按用户决定暂缓引入；中期原版预览与导出仍需先确定该字体方案，其他六类过程文档不受影响。字体用途和引入状态见 [工作台字体集](../font-sets/README.md)。

开发者可从明确的本机来源准备离线环境：

```powershell
.venv/Scripts/python.exe scripts/stage_windows_offline_runtime.py `
  --texlive-root C:/Program/Texlive/texlive/2025 `
  --poppler-zip build/offline-downloads/poppler-26.09.0.zip `
  --poppler-source build/offline-downloads/poppler-26.09.0-source.tar.xz
pnpm package:win:offline
```

Poppler 二进制来源：[上游 Windows 26.09.0 发布](https://github.com/oschwartz10612/poppler-windows/releases/tag/v26.09.0-0)；源码来源：[Poppler 26.09.0](https://poppler.freedesktop.org/poppler-26.09.0.tar.xz)。构建脚本保留已存在的准备目录，避免覆盖此前证据；重新准备时使用新的 `--output` 目录，确认通过后再用于打包。

`verify_windows_offline_runtime.py` 移除系统 TeX/Poppler PATH，核对工具哈希及声明宏包，编译并检查中文 PDF。最终包检查冻结引擎、七类模板与内置论文下载 ZIP。模板准备先检查全部源文件，缺底稿时提前列出具体路径，保留此前构建资源。四类空白评审底稿已由上游授权入库，无需换机后再次转换。最新记录见 [v0.1.5 Windows 整合验证](evidence/WINDOWS_INTEGRATION_20261004.md)。

首次运行的遥测与更新告知沿用现有产品行为；本地构建包含仓库现有的远程服务配置。联网事件需要用户确认告知后才开始，文档内容不进入遥测。

GitHub 下载较慢时，可仅在当前 PowerShell 会话指定镜像。Electron 下载器仍核对包内记录的 SHA-256：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm package:win
```

## Windows 适配要点

- Vite 使用 `fileURLToPath` 转换文件 URL，正确处理盘符和空格。
- Python JSONL 明确使用 UTF-8；冻结后的引擎也重设标准流编码。
- 原生工具的非 UTF-8 日志不会再导致子进程读取线程崩溃。
- 后端构建通过线程和队列等待管道响应，替代 Windows 不支持的管道 `select`。
- Electron 向后端传入明确允许的 Windows 环境目录；Word/WPS 检测读取当前用户/机器的 32/64 位 `App Paths` 注册信息，并核实可执行文件存在。
- Windows 的华文行楷文件名 `STXINGKA.TTF` 映射到受信任模板支持的字体覆盖变量；不替换字体、不复制商业字体进安装包。
- 缺少符号链接创建权限的测试明确跳过，POSIX 权限位检查保留在适用平台执行。

## 用户辅助验证

退出旧应用进程后启动新版本，检查 Word/WPS 状态是否通过。随后使用虚构数据检查档案保存、文档切换、分页预览及三种格式导出，最后在本机 Word/WPS 中逐页核对版式。本次不使用 Computer Use 继续操作界面。

本地开发可从 Git 忽略的 `local-fonts/` 读取私有字体；将来取得分发许可的字体可由运行时 `resources/document-fonts/` 读取。当前没有加入方正字体或重建安装包。自动检查和 PDF 字形检查通过，均不代表规定字体验收或 Word/WPS 人工验收已完成。
