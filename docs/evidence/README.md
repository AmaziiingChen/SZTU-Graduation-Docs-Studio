# 验收证据

本目录保存里程碑和发布门禁的可复核记录。证据文件只记录脱敏事实，不保存真实学生内容、签名、商业字体、凭据、数据库、未经许可确认的官方文件或包含私人路径的日志。

## 记录要求

- 明确提交、分支、操作系统、工具版本、命令、退出码和产物哈希；
- 区分观察到的结果、人工判断、未执行项与阻塞项；
- 截图和日志必须先脱敏，避免用户名、主目录和学生身份信息；
- 文档质量分别记录内容提取、字形有效、逐页检查和 Word/WPS 验收；
- 模板包和发布证据同时记录来源、许可证和再分发检查。

M0 使用 [M0_REPOSITORY_GOVERNANCE_TEMPLATE.md](M0_REPOSITORY_GOVERNANCE_TEMPLATE.md)。当前记录包括 [M0/M1 工程基线](M0_M1_ACCEPTANCE.md)、[M2/M3 合同与本地数据闭环](M2_M3_ACCEPTANCE.md)、[M5 首条导出闭环](M5_PROPOSAL_EXPORT_SLICE.md)、[M5 导出加固与目标编辑器验收](M5_EXPORT_HARDENING_TARGET_EDITOR_QA.md)、[M6 中期检查集成](M6_MIDTERM_INTEGRATION.md)和 [M6 shadcn 官方 Blocks 工作台迁移](M6_SHADCN_BLOCKS_MIGRATION.md)。后续里程碑可复制相同结构并按适用门禁扩展。

2026-09 至 2026-11 的基线、软件审查、源码审计、发布交接与开发清单等时点记录也归档在本目录，包括 [工程基线](BASELINE_20260921.md)、[软件审查](SOFTWARE_REVIEW_20261003.md)、[软件修复](SOFTWARE_FIXES_20261003.md)、[本地与远端源码审计](LOCAL_REMOTE_AUDIT_20261004.md)、[组件复用审计](FRONTEND_COMPONENT_REUSE_AUDIT.md)、[0.1.6 发布交接](RELEASE_HANDOFF_0.1.6.md)、[Windows 0.1.14 故障排查交接](WINDOWS_FAILURE_HANDOFF_2026-11-16.md)、[0.1.14 构建交接](RELEASE_HANDOFF_0.1.14_WINDOWS.md)和[完整开发清单](DEVELOPMENT_CHECKLIST.md)。

逐版发布记录见 `RELEASE_0.*.md`（最新为 [0.2.0](RELEASE_0.2.0.md)）。论文工作台早期实现记录见 [THESIS_WORKBENCH.md](THESIS_WORKBENCH.md)；6 份已完成的实现规格（需求、设计、任务）归档在 [specs/](specs/) 下。
