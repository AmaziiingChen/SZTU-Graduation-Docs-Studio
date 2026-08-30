# SZTU Graduation Docs Studio

一个面向毕业设计过程文档的开源、本地优先桌面工作台。项目目标是让用户填写姓名、学号、学院、专业、指导教师和文档正文等结构化字段后，通过确定性文档引擎导出已套用模板的 Word、LaTeX 和 PDF 文件。

> 当前状态：M6 已将中期检查接入开题报告同一套本地工作台和导出管线。工作台可在
> 开题报告与中期检查之间切换，保存独立草稿与导出历史，并为中期检查执行受信任模板
> 本地安装、严格内容检查、DOCX 深层结构检查、PDF 中文字形门禁和可追溯 LaTeX
> bundle。中期检查正常样例已完成三种格式真实导出和 PDF 三页逐页检查；Word/WPS
> 目标编辑器人工验收尚未完成，模板来源仍是受哈希约束的本地工作树快照。

## MVP 范围

当前可用闭环覆盖 2026 届开题报告和中期检查表：

- 一份本地共享学生档案，以及各过程文档相互独立的正文草稿；
- 基于 JSON Schema 的字段校验；
- DOCX、LaTeX 与 PDF 导出；
- 模板版本、输入/输出哈希和检查回执；
- macOS 与 Windows 环境检查；
- 将 `结构检查通过`、`中文字形有效`、`逐页版式已检查`、`Word/WPS 已验证` 分开记录。

任务书、指导记录和毕业论文将通过版本化模板包逐步加入，不属于当前已实现能力。
中期检查当前开放检查日期、论文题目、论文目录、主要研究内容和进展情况；教师勾选、意见、
签名和日期保持空白。底层模板支持的图片、列表和富文本尚未全部开放为可视化编辑控件。
当前阶段不安排安装包、Release 或发布准备。

姓名、学号、学院、专业、班级和指导教师只在“学生档案”中维护。过程文档页面不提供
这些字段的重复覆盖入口；内容检查、导出预检和最终导出会读取当前关联档案，并把当时
使用的档案值随文档正文一起冻结到导出快照中。

## 产品原则

- **本地优先**：默认不联网、不采集遥测，学生信息与正文保存在本机。
- **确定性排版**：AI 只能提供候选结构化内容，不能直接修改 DOCX、OOXML 或 LaTeX 模板。
- **证据分层**：成功生成文件不等于排版验收通过，Word/WPS 是 Office 文档最终验收依据。
- **模板可追溯**：模板包记录来源、版本、许可证与文件哈希。
- **官方 Blocks 优先**：前端以官方 `dashboard-01` Block 为页面骨架，只组合默认 `shadcn/ui` 组件，不建立自定义视觉系统或 UI 基础组件库。
- **隐私与许可优先**：商业字体、真实学生材料、签名、密钥和未经确认可再分发的学校文件不得进入仓库或 Release。

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

需要 Node.js 24.14.0、pnpm 11.19.0，以及可通过 `python` 调用的 Python 3.12 或更高版本。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
```

`pnpm verify` 会依次运行前端静态检查、前端测试、Python sidecar 测试和生产构建。`pnpm dev` 启动 Vite 与 Electron；首次安装 Electron 运行时需要联网。开发态为保持严格 CSP 已关闭 HMR，renderer 代码修改后请重新加载窗口。

开题报告和中期检查正式渲染器仍作为本地、受哈希约束的模板引擎提供，不把未确认可再分发的
学校 DOCX 放入公开仓库。用户可在工作台选择可信的本地源码快照完成私有安装；安装过程
逐文件核验固定哈希、拒绝符号链接和版本冲突，重复选择同一版本不会覆盖或改写安装时间。
开发环境可分别使用 `SZTU_DOCS_PROPOSAL_ENGINE_DIR` 和
`SZTU_DOCS_MIDTERM_ENGINE_DIR` 指向对应源码快照。中期检查当前基线来自尚未提交的
模板工作树快照，因此不能表述为已发布或可再分发模板包。

完整任务、依赖和逐项完成标准见 [开发清单](docs/DEVELOPMENT_CHECKLIST.md)，当前实测结果见
[M0/M1 验收记录](docs/evidence/M0_M1_ACCEPTANCE.md)、
[M2/M3 验收记录](docs/evidence/M2_M3_ACCEPTANCE.md)和
[M5 首条导出闭环记录](docs/evidence/M5_PROPOSAL_EXPORT_SLICE.md)、
[M5 导出加固与目标编辑器验收记录](docs/evidence/M5_EXPORT_HARDENING_TARGET_EDITOR_QA.md)和
[M6 中期检查集成记录](docs/evidence/M6_MIDTERM_INTEGRATION.md)、
[M6 shadcn 官方 Blocks 工作台迁移记录](docs/evidence/M6_SHADCN_BLOCKS_MIGRATION.md)。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露漏洞或真实学生数据。

## 来源与许可证

本项目采用 [GNU GPL v3](LICENSE)。模板方法与后续模板包会保留深圳技术大学论文模板上游项目的作者、仓库、许可证和修改记录；当前来源与分发边界见 [NOTICE](NOTICE)。

本项目与深圳技术大学不存在官方隶属或背书关系。用户仍需根据所在学院当年正式要求，在 Word 或 WPS 中完成最终核对。
