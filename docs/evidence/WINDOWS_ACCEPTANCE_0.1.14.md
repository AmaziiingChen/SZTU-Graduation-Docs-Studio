# Windows 0.1.14 验收与发布

2026-11-13，Windows 11 x64。按 `docs/evidence/RELEASE_HANDOFF_0.1.14_WINDOWS.md` 构建离线安装包，完成包内引擎、多档案、诊断云端回读和更新通道验证。

## 构建来源

- 应用基线提交为 `6cfa3131ebe40dbfb1c1753263ad07b2d403d467`，分支为 `codex/thesis-workbench`。
- 模板提交为 `35f4b0ffc97fce5ebe36fc58a962da9138370386`。
- 应用版本为 `0.1.14`，通过 `pnpm install --frozen-lockfile` 与 `pnpm package:win:offline` 构建。
- 编译运行时继续使用 `bdb4c8e1ac7053a7`，运行时完整性、宏包、中文 PDF 和安装路径长度检查通过。
- 内置论文工程包版本仍为 `2026.1.1`，包内 `source_revision` 更新为本轮模板提交。论文源文件内容一致，下载包及对应校验元数据同步更新。

构建日志保存在 `build-package-offline-0.1.14.log`。

## 自动检查

- 桌面 67 个测试文件、649 项通过。
- 管理端 3 个测试文件、14 项通过。
- 更新清单工具 4 项通过。
- 后端运行 280 项，其中 8 项按平台条件跳过，其余通过。
- 云端接收器本地 13 项通过。
- 前端设计系统检查、桌面与管理端构建、冻结引擎烟雾检查、Windows 包内容检查通过。保留已有 React lint 警告。

## 包内引擎与多档案

通用引擎验收使用独立合成工作区。七类过程文档均完成内容检查、预览和 Word/PDF 导出，记录位于 `tmp/windows-acceptance-0.1.14/acceptance.json`。

PDF 先提取中文文本，再运行独立 CJK 字形检查，并以 150 DPI 生成页面图。七份 PDF 共 11 页，中文检测区域全部可见，逐页检查了标题、表格边界、分页和签名区。记录位于 `tmp/windows-acceptance-0.1.14/visual/render-gates.json`。这些结果覆盖 PDF 图像，Word/WPS 交互验收仍待人工确认。

新增 `scripts/accept_windows_profiles.mjs`，直接加载安装包内的主进程模块及冻结引擎，完成以下验证。

- 用 0.1.13 引擎生成合成工作区，确认数据库版本为 6，再用 0.1.14 引擎迁移到版本 7。
- 旧档案、已保存草稿和原有三份文档均可读取。
- 两份合成档案分别保存姓名、学号、题目与正文，重启后保留对应的档案及文档。
- 两份任务书分别完成四页预览和 Word/PDF 导出，逐份提取四类字段并排除另一档案内容。
- 不属于当前档案的预览请求返回 `DOCUMENT_PROFILE_MISMATCH`。
- 删除并恢复第一份档案后，两份任务书仍属于各自档案。

原安装目录在验收期间更新到 0.1.14，后续重跑使用首次升级生成的合成版本 6 数据库备份及受管图片。最终记录位于 `tmp/windows-profiles-acceptance-0.1.14-r5/acceptance.json`。本机安装目录的 `app.asar` 与本轮安装包资源一致，SHA-256 为 `7313fe8898b8ee41060c4748d9f344cd519d37c53d18e46acbd42ac20fc1aaab`。安装界面、日常交互和 Word/WPS 人工检查等待用户反馈。

首次验收可运行以下命令，第三个参数必须为新的证据目录。

```powershell
.venv/Scripts/python.exe scripts/accept_windows_bundle.py --bundle release/offline/win-unpacked --runtime-source build/offline-runtime --output tmp/windows-acceptance-0.1.14
node scripts/accept_windows_profiles.mjs release/offline/win-unpacked tmp/windows-profiles-acceptance-0.1.14 --send
```

多档案脚本默认从已安装的 0.1.13 创建旧工作区。如果本机应用已更新，可以用 `--legacy-workspace` 指定此前验收留下的合成工作区。脚本读取其中的 `workspace-before-v6-to-v7-*.sqlite3` 和受管图片，在新的证据目录中验证迁移。`--send` 会向生产诊断端点提交这一份合成故障包。

## 完整诊断包

用不存在的合成导出目录触发 `OUTPUT_DIRECTORY_INVALID`，通过包内 `FullDiagnostics` 保存 ZIP。归档含原始请求、运行环境、档案与文档快照、原始错误、引擎标准错误文件及步骤记录。失败步骤为 `export_input`。

本次合成归档有 11 个文件，共 6614 字节。发送到生产端点后收到有效回执，再通过授权数据库接口按编号读取原始字节，解码得到的 ZIP 与本机文件逐字节一致，SHA-256 一致。回执编号为 `9bb6b9c9-3c1d-47e5-8a54-b449f8b25e5b`。

云端已经部署本轮诊断函数、3.0 格式约束、`full_diagnostic_reports` 表、上传路由与 30 天清理任务。本轮核对这些配置并验证真实上传回读。原始合成归档及云端回读文件保留在上述 `r5` 证据目录。

## 发布产物

Windows 离线安装包为 `release/offline/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe`。

- 字节数为 `429438195`。
- SHA-256 为 `46ad47cb87a9a6539988f9b91b2c9183bbb63d659048b3c693cad2f10d803ca8`。
- 校验文件为 `release/offline/SHA256SUMS-0.1.14.txt`。

公开下载文件与本机安装包校验一致。

[Windows 下载](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/0.1.14/SZTU-Docs-Studio-0.1.14-win-x64-offline.exe)

[校验文件](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/0.1.14/SHA256SUMS-0.1.14-win-x64.txt)

## 更新通道

从腾讯云完整读回 macOS 0.1.14 DMG，其大小为 `138037789` 字节，SHA-256 为 `eec0149ae33386c43fa8fad75e6755005d6dab1b156aa4fab963318daf407f82`。

使用客户端固定公钥对应的原 Ed25519 私钥生成双平台清单。沿用推荐更新和正常服务状态。安装包上传并验证后，发布到正式 stable 地址。

Windows 下载验证使用从 0.1.13 EXE 解出的原版更新模块。待发布清单仅在隔离验证中替代清单响应，安装包通过真实 HTTPS 地址完整下载并核对长度与 SHA-256。正式清单发布后，再用原版模块查询公开地址，确认 Windows 和 macOS 的 0.1.13 能发现 0.1.14，0.1.14 显示为最新。

发布前清单、候选清单和验证结果位于 `tmp/cloud-release-0.1.14/`，可用发布前清单恢复上一个通道状态。
