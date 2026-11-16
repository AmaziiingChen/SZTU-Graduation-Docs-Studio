# GitHub 双系统安装包验收记录

验收日期：2026-11-16。受验代码提交：`b3e0c67adb1aefe0fbca2dbe023f85b10830d64f`，分支 `codex/thesis-workbench`。文档后续提交不改变本次受验代码。

- [双系统基础检查：通过](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272601)
- [双系统原生构建、安装包引擎与诊断验收：通过](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272673)
- 模板固定提交：`35f4b0ffc97fce5ebe36fc58a962da9138370386`。字体和 Windows 运行时来自校验值固定的私有资源。

## 实际执行结果

| 项目 | macOS ARM64 / macos-15 | Windows x64 / windows-2025 |
| --- | --- | --- |
| 本系统原生构建 | 通过，DMG + ZIP | 通过，离线 EXE |
| 安装包来源 | 校验并只读挂载新 DMG | 在干净虚拟机中静默安装新 EXE |
| 包内 app.asar 与刚构建内容逐字节核对 | 通过 | 通过 |
| 安装包内冻结引擎启动 | 通过 | 通过 |
| 七类文档预览、Word/PDF 导出 | 7 / 7，共 11 页预览 | 7 / 7，共 11 页预览 |
| PDF 中文提取和 150 DPI 字形检查 | 通过 | 通过 |
| 两类故障原始 ZIP 生成、发送、接收字节核对 | 2 / 2，缺失清单均为空 | 2 / 2，缺失清单均为空 |
| 后端测试 | 280 通过，4 跳过 | 281 通过，3 跳过 |
| 缺失 COMSPEC、未展开系统 PATH 的实际任务书预览 | Windows 专用用例 | 通过，生成 3 页预览 |

后端跳过项包括两项未启用的用户提交私有任务书样本，以及不属于本系统的权限/工具链用例。安装包的七类文档验收全部使用合成数据，实际启动冻结引擎执行。

| 文档 | macOS 预览页数 | Windows 预览页数 |
| --- | --- | --- |
| `proposal` | 2 | 2 |
| `task_book` | 3 | 3 |
| `midterm` | 2 | 2 |
| `advisor_review` | 1 | 1 |
| `reviewer_review` | 1 | 1 |
| `defense_record` | 1 | 1 |
| `grade_assessment` | 1 | 1 |

## 故障和原始材料

实际触发导出目录不存在（`export_input`）和原生编译器退出 23（`pdf_compile`）。编译故障核对原始输出中的 `CI_SYNTHETIC_COMPILE_FAILURE`，并核对运行时 `frozen: true`。维护端已从 GitHub 下载四份 ZIP，重新核对 SHA-256 和失败步骤；四份材料的 `missing` 均为空。

| 系统 | 故障步骤 | 报告编号 | 文件数 | ZIP 字节数 |
| --- | --- | --- | --- | --- |
| macOS | `export_input` | `cdfa5429-f58d-4343-982f-ea0a250840d9` | 11 | 6052 |
| macOS | `pdf_compile` | `c9a7cbd7-a807-4bae-a474-678f95b781a7` | 50 | 90436 |
| Windows | `export_input` | `213ca7e1-4e69-4c6f-a2ac-1e75981a62df` | 11 | 6681 |
| Windows | `pdf_compile` | `a8bacf45-cb51-4f51-8cf0-5291503b609c` | 50 | 91995 |

传输验收使用安装包内的 FullDiagnostics 和实际生产接收端代码，接收器在构建机的回环地址运行，原始字节存入内存后回读核对。因此这证明客户端和接收处理链路的真实集成，**不证明腾讯云线上数据库已写入**。报告明确记录 `receiver: loopback-production-handler`、`production_cloud_verified: false`。

## 产物和溯源

安装包版本号仍为 0.1.14，仅作为本提交的内部验收包；与当前公开的 0.1.14 安装包不同，必须以提交和 SHA-256 区分。本次没有发布应用版本，没有修改腾讯云文件或稳定更新清单。

| 文件 | 大小（字节） | SHA-256 |
| --- | --- | --- |
| `SZTU-Docs-Studio-0.1.14-mac-arm64.dmg` | 141987418 | `83173e2b46a512ece091bffb864ed777802f60c2941c866ee0618d0fc16bfd5b` |
| `SZTU-Docs-Studio-0.1.14-mac-arm64.zip` | 141696267 | `b759e1694f61eec77618f9acb00ef6c9fc75f268e68f6286e7bc2d5ab0f564dc` |
| `SZTU-Docs-Studio-0.1.14-win-x64-offline.exe` | 428903812 | `233aa81db7cbf6a0f6f91a0fb27f22c6ff01b30db849cb50019fc1e5736f50bd` |

冻结引擎 SHA-256：

- macOS：`381c0787b62fc1c080bedf978e6ac3492bf35d5adc1225fc709c362f4a1f1a69`
- Windows：`cd689c56e2102a5ed695e8bb2accb301c7baef3f4d7f04286acd234c3a26f38f`

- [macOS 内部安装包](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272673/artifacts/14197048903)；[验收材料](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272673/artifacts/14197611614)。
- [Windows 内部安装包](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272673/artifacts/14197623127)；[验收材料](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43802272673/artifacts/14197434111)。
- 内部安装包保留 3 天，验收材料保留 7 天。重新执行后取得新产物，不能长期依赖临时下载链接。

## 结论的边界

本次核实包内模块、冻结引擎、七类文档的预览/Word/PDF 生成、自动中文字形门槛和两类故障传输。完整 Electron 界面交互、逐页人工版式、Word/WPS 显示、苹果公证和 Windows 签名未在本次验收。报告中 `full_page_layout_inspected` 与 `target_editor_verified` 均为 false。

Windows COMSPEC 和 PATH 条件回归已通过，但不能据此确认原用户电脑的唯一根因。中文用户目录、8.3 短路径不可用，以及跨平台慢速更新下载/断线恢复仍需分别验证。操作入口和私有资源维护见 [云端构建与安装包验收](../CI_ACCEPTANCE.md)。
