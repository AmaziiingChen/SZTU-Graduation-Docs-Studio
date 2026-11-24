# 0.1.17 发布记录

发布对象：Windows x64 离线安装包（2026-11-24）。

## 这一版修了什么

| 类别 | 缺陷 | 修复 |
| --- | --- | --- |
| P0 | 论文模板导出在打包版必然失败：模板内部用 `sys.executable` 直接跑 `check_fonts.py`，打包后那是 sidecar 本体 | 模板改为进程内调用 `check_fonts.check()`，不再跨进程 |
| P0 | 界面 120 秒期限短于后端 300 秒预算，长论文被界面先掐断，随后 sidecar 被 SIGKILL，导出记录永远停在 running | 界面期限改为 360 秒，超时归一为 `EXPORT_TIMEOUT` |
| P0 | 字形门禁用 `pdftotext` 写 bbox 文件、用 `pdftocairo` 出图，poppler 的写路径按 ANSI 解释字节，中文临时目录必失败 | 改读 stdout，栅格改用 `pdftoppm`（走 `_wfopen`），并对不支持 `-bbox-layout` 的构建降级为整页墨迹检查 |
| P1 | 环境检查只 `shutil.which` 判断 Poppler，中文机上会假绿 | 实际执行 `-v` 读取版本横幅 |
| P1 | 字体组缺楷体、华文中宋 | 补齐为可选项，不误封导出 |
| P1 | PDF 字体门禁只看名称、不看是否嵌入 | 解析 `pdffonts` 的 emb 列，未嵌入直接拒绝 |
| P1 | 预览 80 页上限让长论文无法导出 | 放宽到 400 页，光栅化超时按页数伸缩 |
| P1 | Windows 取消导出只 terminate 主进程，latexmk/xelatex 变孤儿继续写临时目录，清理时撞锁把原始错误盖掉 | 用 `taskkill /T` 杀进程树 |
| P1 | 导出落盘用硬链接，U 盘与网络盘不支持 | 失败时回退为复制，并给出可操作提示 |
| P2 | `pdftotext` 的 I/O 错误被归为 `tool_nonzero`，用户只看到 `RENDER_FAILED` | 新增 `RENDER_TOOL_PATH_UNSUPPORTED` 等稳定错误码 |
| P2 | 下载完成后的 `rename` 遇到杀软占用直接失败 | 增加 50/100/200/400/800 毫秒重试 |

## macOS 用户的前置依赖

macOS 安装包不内置 TeX 与 Poppler。首次启动时若缺少必需组件，应用会自动打开「环境检查」
对话框，逐项给出安装方式（MacTeX、`brew install poppler`、缺失字体）。此前这份指引只能从
「查看环境修复指引」手动打开，新用户在第一次预览失败前看不到它。

## 验证

- `pnpm verify`：68 个测试文件、660 项前端测试、后端 306 项、telemetry 14 项全绿。
- `Chinese path matrix`：Windows 与 macOS 各跑 7 类文档，中文数据目录与中文导出目录均通过。
- `Chinese profile acceptance`：以中文用户名标准账户装离线包，7 类文档 11 页通过，引擎位于
  `C:\ProgramData\SZTU-Docs\engine\bdb4c8e1ac7053a7`，旧式用户目录副本不存在。
- 论文模板：`templates/thesis/test.py` 在 macOS 与 Windows 托管机均通过（25 页 + 3 页压力样例）。

## 发布物

| 平台 | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Windows x64 | `SZTU-Docs-Studio-0.1.17-win-x64-offline.exe` | 429,907,331 | `6b1b50537a7e99374b32f4ef9e7301eb46bb2de7ddd6bde1c6aa4030b9b23de8` |

更新清单：`releases/stable/manifest.json`，800 字节，
SHA-256 `f114a3e631b2984fb1a1118df64d2f8af69f4e80213a20335a49b972bf241087`。

本次只发布 Windows 产物，清单中没有 darwin 条目；macOS 客户端检查更新会报“没有适用产物”，
待 macOS 包补齐后重新签名即可恢复双平台。
