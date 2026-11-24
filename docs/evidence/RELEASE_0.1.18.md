# 0.1.18 发布记录

发布对象：Windows x64 离线安装包（2026-11-24）。本次只有 Windows 产物，清单不含 darwin 条目。

## 与 0.1.17 的差别

| 类别 | 改动 | 影响 |
| --- | --- | --- |
| 引导 | 首次启动且必需组件缺失时自动打开「环境检查」，逐项给出 MacTeX、Poppler、字体安装方式 | 新用户不必先撞一次预览失败才知道缺什么；每台机器只自动弹一次，之后仍可从「查看环境修复指引」打开 |
| 更新 | 清单里没有本平台产物时视为“已是最新”，不再抛 `No update artifact for this platform` | 允许只发单平台版本；只发 Windows 时 macOS 客户端显示已是最新，不报错 |
| 文档 | README 增加 macOS 前置依赖表；`docs/TELEMETRY_AND_UPDATES.md` 更新清单口径 | 安装前就知道要准备约 4 GB 的 MacTeX |

0.1.17 的 11 项缺陷修复全部包含在 0.1.18 中。

## 验证

- `pnpm lint`：0 errors（43 条既有 warning）。
- `npx vitest run src/App.test.tsx`：131 项通过（含改写后的两个环境引导用例）。
- `npx vitest run tests/update-service-regressions.test.ts tests/remote-services.test.ts`：26 项通过。
- 两套 `tsc` 均通过。
- CI：`Package acceptance` 在 windows-2025 上重新打包并跑 7 类文档验收。

## 发布物

| 平台 | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Windows x64 | `SZTU-Docs-Studio-0.1.18-win-x64-offline.exe` | 见下方清单 | 见下方清单 |

清单：`releases/stable/manifest.json`（同时保留 `releases/0.1.18/manifest.json`）。

## 回滚

把 0.1.17 的清单重新 deploy 到 `releases/stable/manifest.json` 即可（800 字节，
SHA-256 `f114a3e631b2984fb1a1118df64d2f8af69f4e80213a20335a49b972bf241087`）；0.1.18 的产物留在
`releases/0.1.18/` 不影响回滚。
