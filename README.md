# SZTU Graduation Docs Studio

一个面向毕业设计过程文档的开源、本地优先桌面工作台。项目目标是让用户填写姓名、学号、学院、专业、指导教师和文档正文等结构化字段后，通过确定性文档引擎导出已套用模板的 Word、LaTeX 和 PDF 文件。

> 当前状态：M6 已将任务书和中期检查接入开题报告同一套本地工作台和导出管线。工作台可在
> 开题报告、任务书与中期检查之间切换，保存独立草稿与导出历史，并为过程文档执行受信任模板
> 本地安装、严格内容检查、DOCX 深层结构检查、PDF 中文字形门禁和可追溯 LaTeX
> bundle。中期检查正常样例已完成三种格式真实导出和 PDF 三页逐页检查；Word/WPS
> 目标编辑器人工验收尚未完成。开发态会实时读取相邻或显式关联的本地模板工程，按当前
> 文件内容生成不可变快照；正式模板仍使用固定版本和哈希门禁。预览不随输入逐字刷新；
> 用户点击顶部“预览&导出”后，工作台打开右侧抽屉并自动使用正式 PDF 管线生成 150 DPI 分页图，确认后可直接在抽屉底部选择导出格式。

> 本地开发版本的毕业论文入口已接入 LaTeX 模板下载。学生保存并解压后，在自己的编辑器或 Agent 中完成写作与排版。资源构建方式见 [模板下载维护说明](docs/THESIS_TEMPLATE_DOWNLOAD.md)。

## MVP 范围

本地开发版本新增指导教师评审表、评阅人评审表、答辩记录表和成绩考核表。四份表格固定为 A4 一页，基本信息从学生档案带入，姓名、学号、学院、专业和论文题目齐全即可打印；其余信息及评审内容允许留空，签名空间保留手写。各业务栏目沿用任务书的独立栏目导航，日期复用 `DocumentDateField`，所有格式共用预览抽屉内的一个“导出”菜单。PDF 用于现场打印，Word 和 LaTeX 源码为补充格式。填写内容超过固定区域时拒绝导出，不缩小官方字号、行距或签名空间。

下半部分当前开放编辑，开关集中在 `apps/desktop/src/lib/assessment-documents.ts` 的 `lowerEditingEnabled`；关闭后保留已保存内容和导出能力。四种模板各自使用受控文件清单和不可变工作区快照，共用同一结构化输入及公共渲染能力。它们尚未进入已发布安装包。

评语和分工的括号说明、答辩记录的引导说明与正文在同一个现有编辑器中编辑，新文档的光标进入说明之后的正文空段。说明单独保存到 `sections.writing_guidance`（`comments`、`division_of_work`、`questions`），正文不混入模板固定标签。删除说明保存为 `null`；换行后的新段、将说明改为列表后的文字按普通正文保存。导出时固定标签继续由模板提供，说明紧接其后，删除说明只省略说明本身。旧草稿迁移只裁剪可识别的旧固定标签，并保留正文及富文本；无法可靠识别的自定义文字全部保留为正文。`sections.editable_headings` 继续兼容旧草稿，已有 `writing_guidance` 映射的草稿不会自动重新补入说明。

满页打印规则记录在各模板规格中：保留原件结构、字体字号、页边距和签署区域，按现场手写需要明确原件自动/最小行高的打印高度。页面检查同时验证实际表格底边、标题位置及学院/专业字形到表格的间距；单页、字形有效和 Word/WPS 验证分别记录。

当前可用闭环覆盖 2026 届开题报告、毕业论文任务书和中期检查表：

- 一份本地共享学生档案，以及各过程文档相互独立的正文草稿；
- 基于 JSON Schema 的字段校验；
- DOCX、LaTeX 与 PDF 导出；
- 用户主动生成、编辑后自动失效的分页 PDF 预览；
- 模板版本、输入/输出哈希和检查回执；
- macOS 与 Windows 环境检查；
- 将 `结构检查通过`、`中文字形有效`、`逐页版式已检查`、`Word/WPS 已验证` 分开记录。

指导记录和毕业论文将通过版本化模板包逐步加入，不属于当前已实现能力。
任务书已接入基本内容与要求、进度安排、所需资料、参考文献和选题信息；毕业年份从学生档案
中的毕业届别统一派生，教师意见、签名和日期继续保留为空白。
中期检查当前开放检查日期、论文题目、论文目录、主要研究内容和进展情况；教师勾选、意见、
签名和日期保持空白。底层模板支持的图片、列表和富文本尚未全部开放为可视化编辑控件。
Windows x64 0.1.6 离线验收包已构建，已整合工作台新功能、四类评审模板及内置论文 LaTeX 工程下载，保留所需 TeX 和 Poppler。自动检查及七类文档导出通过，安装升级记录与待完成的 Word/WPS 人工验收见 [0.1.6 验收记录](docs/evidence/WINDOWS_ACCEPTANCE_0.1.6.md)和 [macOS 接续说明](docs/RELEASE_HANDOFF_0.1.6.md)。完整开发流程见 [Windows 开发与打包](docs/WINDOWS_DEVELOPMENT.md)。

姓名、学号、学院、专业、班级和指导教师只在“学生档案”中维护。过程文档页面不提供
这些字段的重复覆盖入口；内容检查、导出预检和最终导出会读取当前关联档案，并把当时
使用的档案值随文档正文一起冻结到导出快照中。

## 产品原则

- **本地文档处理**：学生信息、正文、参考文献、模板内容和导出文件只在本机处理；正式构建在首次明确告知并确认后联网发送不含内容的匿名运行事件并检查更新。
- **确定性排版**：AI 只能提供候选结构化内容，不能直接修改 DOCX、OOXML 或 LaTeX 模板。
- **证据分层**：成功生成文件不等于排版验收通过，Word/WPS 是 Office 文档最终验收依据。
- **模板可追溯**：模板包记录来源、版本、许可证与文件哈希。
- **开发模板串联**：本地模板工程每次检查和导出前重新计算内容指纹，并先冻结为私有快照；不直接执行修改中的源文件。
- **先预览再导出**：点击“预览&导出”后才使用正式 PDF 管线生成分页预览；已有当前有效预览时直接复用，正文、档案或模板变化后自动重新生成，预览不会写入导出历史。
- **官方 Blocks 优先**：前端以官方 `dashboard-01` Block 为页面骨架，只组合默认 `shadcn/ui` 组件，不建立自定义视觉系统或 UI 基础组件库。
- **隐私与许可优先**：匿名遥测严格使用字段允许列表，不发送身份、正文、路径或自由文本；商业字体、真实学生材料、签名、密钥和未经确认可再分发的学校文件不得进入仓库或 Release。

## 技术路线

- Electron + React + TypeScript + Vite；
- 默认 `shadcn/ui`、官方 `dashboard-01` Blocks 结构与 Tailwind CSS；
- Python 文档引擎，以版本化 JSONL IPC 连接 Electron 主进程；
- SQLite 本地存储；
- JSON Schema 数据合同；
- `python-docx` 生成 Word，XeLaTeX 生成 LaTeX/PDF。

计划目录：

```text
apps/desktop/          Electron main、preload 与 React renderer
backend/               Python 文档引擎与 SQLite 访问
contracts/             JSON Schema 与 IPC 合同
template-packs/        经许可核对、可公开分发的模板包
tests/                 跨进程、端到端与发布验收
scripts/               构建、检查与发布工具
docs/                  决策、架构、隐私与验收证据
```

## 本地开发

需要 Node.js 24.14.0、pnpm 11.19.0，以及可通过 `python` 调用的 Python 3.11 或更高版本。
分页预览还需要 XeLaTeX 和 Poppler；Word 与中文字形检查所需的 `python-docx`、`Pillow`
会安装到仓库内、已被 Git 忽略的 `.venv`，不会修改全局 Python。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm setup:backend
pnpm verify
pnpm dev
```

`pnpm dev` 会在启动前自动执行一次幂等的 `setup:backend`；依赖已经满足时不会重复安装。
`pnpm verify` 也使用同一份 `.venv`，避免测试与桌面应用调用不同 Python。首次准备 Node、
Electron 或 Python 依赖时需要联网。`pnpm dev` 启动 Vite 与 Electron；开发态为保持严格 CSP
已关闭 HMR，renderer 或 Electron 代码修改后请重新启动开发进程。

在 Windows 上继续开发时，把应用仓库和模板 fork 克隆为同级目录；当前模板开发分支为
`codex/thesis-workbench`，本地开发环境会从相邻的 `Thesis` 目录读取过程文档模板：

```powershell
git clone https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio.git
git clone --branch codex/thesis-workbench https://github.com/AmaziiingChen/SZTU-Thesis-Latex-Template.git Thesis
cd SZTU-Graduation-Docs-Studio
corepack enable
pnpm install --frozen-lockfile
pnpm setup:backend
pnpm verify
pnpm dev
```

Windows 还需按文档功能安装 XeLaTeX、Poppler 和所需的合法字体。运行 `pnpm package:win` 生成内置 Python 引擎的 x64 安装包；完整环境准备、模板限制和验证记录见 [Windows 开发与打包](docs/WINDOWS_DEVELOPMENT.md)及 [Windows 本地验证记录](docs/evidence/WINDOWS_20260930.md)。Word/WPS 人工验收须在目标机器上单独完成。

## macOS 本地预览安装包

在 Apple Silicon Mac 上运行 `pnpm package:mac`，会先执行完整校验，再生成 ARM64 的 DMG 和 ZIP。
安装包内置本地 Python 文档引擎，但不内置宋体、黑体、Times New Roman 等文档字体，也不内置
TeX Live、XeLaTeX、latexmk 或 Poppler；首次启动的环境检查会提示用户准备这些本机依赖。
界面自身继续使用项目已有的开源 Geist Web 字体，这不属于文档模板字体。

当前安装包没有 Apple Developer ID 签名或公证，macOS 可能显示 Gatekeeper 提示。具体构建边界见
[macOS 打包说明](docs/MACOS_PACKAGING.md)。

填写文档后点击顶部的“预览&导出”。右侧抽屉会立即打开，并在没有当前有效预览时自动保存、检查和生成与正式 PDF 导出共用模板引擎的
逐页图像；已有有效结果时直接打开，不重复生成。继续编辑正文、修改学生档案或更新模板后，下次打开抽屉会自动重新生成；导出格式统一在抽屉底部选择。
预览确认只代表当前 PDF 页面可供审阅，不等于 Word/WPS 目标编辑器验收通过。

开题报告和中期检查的本地开发模板可通过工作台“关联或更新本地模板工程”选择一次。之后每次
环境检查、导出预检和正式导出都会重新读取允许清单中的文件、拒绝符号链接、计算组合 SHA-256，
再复制为应用私有目录中的内容寻址快照；回执记录 `workspace.<指纹>` 版本。预检后源文件若变化，
旧令牌不会匹配新快照，必须重新预检。开发检出中若存在相邻的 `../Thesis`，应用也会
自动采用同一同步流程。`SZTU_DOCS_PROPOSAL_ENGINE_DIR` 和
`SZTU_DOCS_MIDTERM_ENGINE_DIR` 可显式覆盖开发来源。

开发工作区快照不等于已验收或可发布模板。正式模板仍须固定版本、逐文件哈希、来源与许可证，
并继续拒绝任何哈希漂移；未确认可再分发的学校 DOCX 不进入公开仓库或 Release。

匿名遥测和更新通道的客户端基础已经接入，但开发构建未配置远程端点。首次启动会在任何上传前
说明允许发送与禁止发送的字段；使用者可以“同意并继续”或退出。确认后应用记录启动、粗粒度
运行时长、页面类型及检查/预览/同步模板/导出/验收结果，随机安装标识每 30 天轮换；不发送
学生档案、论文题目、正文、参考文献、文件名、路径、模板内容、哈希或自由文本。版本检查使用
Ed25519 签名清单，并在下载后核对平台、架构、文件大小和 SHA-256。当前只完成校验下载，尚未
完成安装包替换、代码签名和回滚，因此不属于已发布的自动更新。详见
[匿名遥测与更新通道](docs/TELEMETRY_AND_UPDATES.md)。

完整任务、依赖和逐项完成标准见 [开发清单](docs/DEVELOPMENT_CHECKLIST.md)，当前实测结果见
[M0/M1 验收记录](docs/evidence/M0_M1_ACCEPTANCE.md)、
[M2/M3 验收记录](docs/evidence/M2_M3_ACCEPTANCE.md)和
[M5 首条导出闭环记录](docs/evidence/M5_PROPOSAL_EXPORT_SLICE.md)、
[M5 导出加固与目标编辑器验收记录](docs/evidence/M5_EXPORT_HARDENING_TARGET_EDITOR_QA.md)和
[M6 中期检查集成记录](docs/evidence/M6_MIDTERM_INTEGRATION.md)、
[M6 shadcn 官方 Blocks 工作台迁移记录](docs/evidence/M6_SHADCN_BLOCKS_MIGRATION.md)和
[M6 显式分页预览记录](docs/evidence/M6_EXPLICIT_PAGINATED_PREVIEW.md)和
[M6 预览运行时修复记录](docs/evidence/M6_PREVIEW_RUNTIME_RECOVERY.md)。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露漏洞或真实学生数据。

## 来源与许可证

本项目采用 [GNU GPL v3](LICENSE)。模板方法与后续模板包会保留深圳技术大学论文模板上游项目的作者、仓库、许可证和修改记录；当前来源与分发边界见 [NOTICE](NOTICE)。

本项目与深圳技术大学不存在官方隶属或背书关系。用户仍需根据所在学院当年正式要求，在 Word 或 WPS 中完成最终核对。
