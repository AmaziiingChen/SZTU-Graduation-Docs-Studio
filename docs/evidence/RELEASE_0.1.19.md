# 0.1.19 发布记录

发布对象：Windows x64 离线安装包。

## 修复

论文模板在干净 Windows 上导出失败（`REQUIRED_FONT_MISSING`），根因是安装包只随包带了方正小标宋一款字体，
而模板还要求华文中宋（论文中文摘要上方的题名，`SZTUthesis.cls:577`）与华文行楷（任务书封面校名，
`templates/task-book/latex/render.py:424`）。这两款随 Office 安装，纯净系统没有。

| 改动 | 位置 |
| --- | --- |
| 打包前把华文中宋、华文行楷、方正小标宋收进 `local-fonts/` | `scripts/stage_document_fonts.py`（新增），由 `scripts/package_windows.mjs:35` 调用 |
| Windows 安装包把三款字体打进 `resources/document-fonts` | `apps/desktop/electron-builder.offline.yml:8-15` |
| 打包校验必须找到这三款字体 | `scripts/verify_windows_app_bundle.py`（新增断言） |

应用启动时 `documentFontDirectories()`（`apps/desktop/electron/document-fonts.ts`）会把
`resources/document-fonts` 加进 `SZTU_FONT_DIR`，模板的字体检查因此能直接找到它们，
用户不需要在系统里装 Office 字体。

宋体、黑体、楷体、Times New Roman 仍依赖系统自备——Windows 与 macOS 都自带，不进包以控制体积。

## 兼容性

- 安装包体积增加约 20 MB（三款字体合计约 20.1 MB）。
- 已装 0.1.18 的机器升级后即可导出论文，无需额外操作。

## 验证

- `python3 scripts/stage_document_fonts.py`：三款字体就位（`FZXiaoBiaoSong-B05S.ttf` 4,045,592 B、
  `STXingkai.ttf` 4,009,504 B、`STZhongsong.ttf` 12,128,500 B）。
- `python3 templates/thesis/test.py`：本机通过（25 页 + 3 页压力样例）。
- Windows 侧由 `Package acceptance` 在 windows-2025 上重新打包并跑 7 类文档验收。

## 产物与发布（2026-11-25）

| 项目 | 值 |
| --- | --- |
| 构建 | `Package acceptance 45575852547`（commit `88b64e5`），双平台 success |
| 安装包 | `SZTU-Docs-Studio-0.1.19-win-x64-offline.exe` 439,613,820 B |
| SHA-256 | `88ae135a1c95a8c995607eb2deba8d6d4f4034131e277642d0854cfd49b2da6e` |
| 更新清单 | 800 B，SHA-256 `e01c74933ed0d3553a82158e0f4085102c342799f47787a3da0f501d02e35ffd`，仅含 `win32/x64` |
| 发布路径 | `releases/0.1.19/` 与 `releases/stable/manifest.json` |
| 公网复核 | 清单 200 / 800 B / 哈希一致 / version 0.1.19；安装包 200 / 439,613,820 B |
| 签名校验 | 固定 Ed25519 公钥验签通过 |

macOS 版本次不重打：客户端已能容忍清单中缺少本平台产物（`update-service.ts` 的
`up_to_date` 分支），macOS 用户停留在 0.1.18，不会报错。
