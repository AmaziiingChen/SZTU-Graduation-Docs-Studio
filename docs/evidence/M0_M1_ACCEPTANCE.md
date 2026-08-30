# M0/M1 工程基线验收记录

- 日期：2026-08-30（Asia/Shanghai）
- 验收范围：独立仓库治理、安全桌面骨架、默认 shadcn 工作台、Python JSONL sidecar
- 结论：工程基线通过；产品 MVP 未完成
- Git 边界：独立 `main` 仓库已初始化，但本次按授权边界未提交、未配置远程、未推送、未创建 PR

## 1. 前置保护

源模板仓库只做了只读 P0 审计，快照见 [P0_AUDIT.md](P0_AUDIT.md)。审计确认 `texclear.sh` 中的 `git clean -X -fd` 会命中被忽略的私人参考资料和输出目录，因此本项目及相邻模板仓库永久禁止运行 `texclear.sh`、`git clean -X` 和 `git clean -x`。

本应用代码建立在独立 Git 仓库中，没有复制模板仓库 `.git` 历史，也没有导入商业字体、真实学生资料、签名或再分发权未确认的官方文件。

## 2. M0 仓库与治理

已建立：

- GPL-3.0 `LICENSE`、`NOTICE`、贡献指南、安全策略、行为准则和 Issue/PR 模板；
- 根 `AGENTS.md`，固定默认 shadcn、Electron 安全边界、隐私边界和中文文档四道验收门；
- pnpm workspace、根锁文件、Node/Python 版本文件、UTF-8/LF 与忽略规则；
- 架构、前端、许可和证据分层 ADR；
- macOS/Windows CI 定义：桌面 lint/test/build；Python 3.12/3.14 sidecar 测试；
- 完整开发清单和 `docs/evidence/` 证据目录。

CI 工作流已经定义但尚未在 GitHub runner 上执行，因此 Windows、Python 3.12 和远端干净检出的结果仍为未验证，不能标记为通过。

## 3. M1 安全桌面骨架

### Electron 安全边界

- `contextIsolation: true`；
- `nodeIntegration: false`；
- `sandbox: true`；
- `webSecurity: true`；
- 默认拒绝权限请求、新窗口和非信任导航；
- 严格 CSP；开发态关闭 HMR，避免用 `unsafe-inline` 放松 `script-src`；
- preload 编译为 sandbox 支持的 CommonJS，只暴露 `getAppInfo` 和 `checkEnvironment`；
- IPC 校验 sender，sidecar 使用参数数组且 `shell: false` 启动；
- 单实例锁、请求超时和退出清理已经建立。

### 工作台

前端通过 shadcn 官方 CLI 初始化，使用其默认 Base UI/Nova 配置和默认 token。页面是标准三栏工作台：

1. 左侧：学生档案、开题报告及后续文档导航；
2. 中间：开题报告基本信息与正文结构化字段；
3. 右侧：本机环境和四类相互独立的文档质量状态。

没有新增自研 UI primitive、第二套 `ui/`、品牌配色或自定义设计 token。保存、合同校验和导出按钮明确显示为后续里程碑能力，不伪装成可用功能。

### Python sidecar 与合同

- Python 3.11+、仅标准库的 JSONL sidecar；
- 稳定协议 `1.0`，实现 `system.ping`、`system.version`、`environment.check`；
- stdout 只写协议响应，诊断写 stderr；
- 包含请求格式、未知方法、错误隔离、Unicode、坏 JSON 和进程级测试；
- `contracts/` 保存 IPC、环境结果和带来源哈希的 proposal Schema。

## 4. 自动检查

最终本机命令：

```text
pnpm install --frozen-lockfile  -> exit 0
pnpm verify                     -> exit 0
git diff --check                -> exit 0
JSON 合同与包清单解析            -> exit 0
```

`pnpm verify` 的最终结果：

| 检查 | 结果 |
| --- | --- |
| Oxlint | exit 0；5 条告警均位于 shadcn 官方生成文件/其 `use-mobile` hook，无业务代码告警 |
| Vitest | 2 个测试文件、5 项测试通过 |
| Python unittest | 19 项测试通过 |
| TypeScript + Vite | 2054 modules transformed，生产构建通过 |
| Electron 安全源断言 | BrowserWindow、安全 preload、renderer 无 Node import 均通过 |
| sidecar 失败态 | UI 错误状态测试通过 |

工具链实测快照：Node.js 24.14.0、pnpm 11.19.0、`python` 3.13.13、`python3` 3.14.4、Git 2.50.1、Electron 44.0.0。Python 3.12 只在 CI 矩阵中声明，尚未有本次运行证据。

## 5. 真实桌面联调

通过 macOS Electron 窗口与可访问性树完成可见验收，截图见 [M1_WORKBENCH_MACOS.jpeg](M1_WORKBENCH_MACOS.jpeg)。实测结果：

- 中文标题、导航、表单、提示和状态文字均可读；
- 三栏结构、滚动区域和顶部操作区完整出现；
- preload/IPC/sidecar 真实连通；
- 返回 Darwin、Python 3.14.4、可写临时目录、XeLaTeX 可用和 Word 兼容编辑器可用；
- 结构检查、中文字形、逐页版式、Word/WPS 四项仍显示“未检查”。

本截图只证明桌面 UI 的可见状态，不是 Word、WPS、PDF 或 LaTeX 文档版式验收证据。

Electron 官方二进制直接下载曾因 Node fetch 网络失败而中断；随后从国内镜像获取同名 Release 文件，并在解压前对照 Electron 包内官方 SHA-256 `076d79742986e1b100b69ebecc691cb07368045e54c9087cef631b8622b76a80` 校验一致。依赖运行时未进入 Git。

## 6. 未完成门禁

- 尚未建立 Git 提交、GitHub 远程、CI 运行或 PR；
- 尚未实现 SQLite 学生档案、草稿保存、恢复和临时模式；
- 尚未完成 proposal 全合同、模板包 manifest、DOCX/LaTeX/PDF 导出与回执；
- 尚未执行新应用的中文 PDF 字形门、逐页版式和 Word/WPS 目标编辑器矩阵；
- 尚未完成依赖漏洞、第三方许可证、安装包、签名和 Release 验收；
- 模板源仓库 P0 仍需备份私人资料、修正危险清理脚本、形成原子提交并恢复 GitHub 认证。

因此，本记录只接受 M0/M1 工程基线，不接受 MVP、正式导出、跨平台发布或文档排版质量完成声明。
