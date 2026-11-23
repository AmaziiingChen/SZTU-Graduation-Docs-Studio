# 编译与渲染缺陷审计（2026-11-23）

## 为什么做这次审计

学生提交的诊断包 `ca017910-aef3-43aa-a7ba-d8fa97ed751e`（app 0.1.16，用户目录
`C:\Users\小林学长`）显示：引擎已经装到 `C:\ProgramData\SZTU-Docs\engine\…`，
XeLaTeX 编译成功，但字形校验失败，界面只显示「文档生成失败，请重试」。

根因不是同一个 bug 复发，而是同一**类**问题：poppler 的 `pdftotext` 写输出文件时用
裸 `fopen()`，Windows 把它按 ANSI 解释，于是 `C:\Users\<中文>\AppData\Local\Temp\…\bbox.html`
打不开；同一路径读 PDF 却没问题，因为 `openFile()` 走 `_wfopen()`。

既然一类问题能绕过 CI 两次，这次不再逐个修，而是把所有「平台相关、路径相关、
时限相关」的失败面一次性排查并修复。

## 平台事实（来自 poppler 源码）

| 调用 | 写文件方式 | 中文路径 |
| --- | --- | --- |
| 读输入（`goo/gfile.cc` `openFile()`） | `_wfopen()` | 安全 |
| `pdftotext … out.html`（`utils/pdftotext.cc`） | 裸 `fopen()` | **失败** |
| `pdftocairo -png`（`utils/pdftocairo.cc`） | 裸 `fopen()` | **失败** |
| `pdftoppm`（`splash/SplashBitmap.cc` `writeImgFile()`） | `openFile()` | 安全 |
| 所有工具 | 参数经 `utf16ToUtf8` | 读安全、写取决于上面几行 |

推论：任何「把 poppler 的输出写到用户目录」的代码都必须改成 stdout 或 ASCII 暂存目录。

## 已修复

### 会直接让导出失败（P0）

1. **论文模板一定导出失败**：`templates/thesis/latex/render.py` 用
   `subprocess.run([sys.executable, "scripts/check_fonts.py"], …)`。打包后
   `sys.executable` 是 sidecar 本体，它只接受 `--run-python-script`，于是每次论文导出都
   以 `Unsupported packaged-sidecar arguments.` 失败。改为在进程内 `importlib` 加载
   `check_fonts.py` 并调用 `check(None, save=True)`，源码版与安装版走同一条路径。
2. **界面 120 秒 vs 后端 300 秒**：论文导出后端给 300 秒，界面 120 秒就放弃，随后整
   sidecar 被 SIGKILL，导出历史永远停在 `running`。界面时限改为 360 秒，并把超时统一
   成 `EXPORT_TIMEOUT`，保留原始错误码便于诊断。
3. **字形门禁写 bbox**：`scripts/validate_cjk_render.py` 改为 `pdftotext -enc UTF-8
   -bbox-layout <pdf> -` 读 stdout；光栅化从 `pdftocairo` 换成 `pdftoppm`（前者写文件
   不安全，后者安全）。

### 会误判、卡死或损坏结果（P1）

- 环境检查对 Poppler 只做 `shutil.which`，中文机器上假绿 → 现在额外执行 `-v` 读版本横幅。
- 字体组缺楷体、华文中宋 → 补进 `SPECIAL_DOCUMENT_FONT_GROUPS`（非必需项，不会误封导出）。
- `export.preflight` 的 `ready` 恒为真 → 现在读环境阻塞项，内置引擎在非 ASCII 路径、
  缺 PDF 工具都会让 `ready` 为假并给出 `blocking_codes`。
- PDF 字体门禁只看名字、不看是否嵌入 → 现在解析 `pdffonts` 的 `emb` 列，未嵌入即
  `PDF_FONT_NOT_EMBEDDED`。
- 预览 80 页硬上限把长论文卡在「页面数量无效」→ 上限提到 400 页，光栅化超时按页数伸缩。
- Windows 取消只 `terminate()`，latexmk/xelatex 变孤儿继续写临时目录 → 改用
  `taskkill /T` 杀进程树。
- 导出落盘用 `os.link`，U 盘与多数网络盘不支持硬链接 → 失败时回退普通复制，仍失败则报
  `OUTPUT_TARGET_UNSUPPORTED`；输出路径过长（≥240 字符）单独报 `OUTPUT_PATH_TOO_LONG`。
- 字形门禁固定 45 秒，长论文被误判超时 → 改为 `15 + 2 × 页数`，夹在 45–300 秒。
- poppler 的 `Couldn't open text file` / `I/O Error` 被归成 `tool_nonzero` → 现在映射为
  `RENDER_TOOL_PATH_UNSUPPORTED` 并给出中文可操作提示。
- 模板把 `Overfull \hbox` 当致命错误 → 现在只有未解析引用/控制序列才是致命，版面警告
  单独记录。
- 更新包下载后的 `rename` 没有重试，杀毒软件占用时直接失败 → 加退避重试。

### 诊断与临时目录（P2）

- 渲染环境重定向 `TEXMFVAR`/`TEXMFCACHE` 到引擎自己的 `texmf-var`，不再依赖用户目录。
- `TEMP`/`TMP`/`TMPDIR` 若为空或非 ASCII，改用 `%PROGRAMDATA%\SZTU-Docs\tmp`（可写探针）。
- `tool_output.py` 用 UTF-8 → GB18030 → 替换的顺序解码工具输出，中文控制台不再出现 `????`。

## 没有改的

- **安装目录名**：`productName` 仍是「SZTU文档工作台」。改成 ASCII 会改变 userData 路径，
  等于让所有现有学生的档案「消失」，风险远大于收益。引擎根与临时目录已经与安装目录解耦。
- **断点续传**：CDN 对 `Range` 返回 200 全量，加续传需要先换 CDN 行为，不在本次范围。
- **macOS 打包 TeX/Poppler**：安装包体积会从 140 MB 涨到数 GB，继续依赖用户自装。

## 新增的验收

- `scripts/accept_chinese_paths.mjs`：用**中文数据目录 + 中文导出目录 + 中文临时目录**把
  7 类过程文档各走一遍 `workspace.open → saveDraft → preview.generate → export.preflight
  → export.run`，再对成品 PDF 跑字形门禁。任何失败都带稳定错误码退出。
- `.github/workflows/chinese-path-matrix.yml`：Windows 与 macOS 各跑一次上面的脚本，并另设
  论文作业（信息性，待 Windows 托管机校准后转阻塞）。
- `scripts/test_validate_cjk_render.py`：门禁自身的单元测试，已被
  `scripts/run_backend_tests.py` 自动发现。

## 本机验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm verify` | 68 文件 / 660 测试通过；telemetry 14 通过；后端 306 通过；构建成功 |
| `node scripts/accept_chinese_paths.mjs` | 7 类文档全部 PASS（中文路径，macOS） |
| `python3 templates/thesis/test.py` | 论文 25 页 + 参考文献压力样例 3 页 PASS |
| `scripts/validate_cjk_render.py` 中文目录 | `pages=25 words=734 visible=734 blank=0 rate=100.0%` |

## Windows 机器的验证步骤

1. `git fetch && git switch codex/thesis-workbench && git pull`
2. 拉模板：同目录 `AmaziiingChen/SZTU-Thesis-Latex-Template` 的 `codex/thesis-workbench`
   分支（本次已推 `2f25a02`，工作流里也已改钉这个提交）。
3. `pnpm install && pnpm setup:backend`
4. `node scripts/accept_chinese_paths.mjs tmp/chinese-path-matrix`
   - 在 PowerShell 里先把 `$env:TEMP` 指到中文目录，才等于复现学生环境。
   - 结果看 `tmp/chinese-path-matrix/chinese-paths.json`。
5. 需要连续覆盖安装时，先 `pnpm package:win:offline` 出包，再跑安装器。
