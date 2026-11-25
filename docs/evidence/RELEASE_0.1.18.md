# 0.1.18 发布记录

发布对象：Windows x64 离线安装包与 macOS arm64 DMG（2026-11-25）。清单同时包含 win32/x64 与 darwin/arm64 两条产物。

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
| Windows x64 | `SZTU-Docs-Studio-0.1.18-win-x64-offline.exe` | 429,906,274 | `31465fc9d49f262829b221f971ddb19446ff4ee05f41b7a0bc15ad70caba233a` |
| macOS arm64 | `SZTU-Docs-Studio-0.1.18-mac-arm64.dmg` | 141,972,388 | `feb01d75a739ef54f1923b2c615390ff82d450478778039dcbcfb75219046404` |

同批还导出了 macOS 的 ZIP 压缩包（141,718,145 字节，SHA-256 `ea2c80187c37fe6dc5c91e00379073307168dee28eafaf250f61ee5d0fc24030d`），
未写入清单，仅用于直接分发。DMG 内的应用为 ad-hoc 签名、未公证，首次打开需右键「打开」放行；macOS 版不内置 TeX，
用户需自备 MacTeX 与 Poppler。

清单：`releases/stable/manifest.json`（同时保留 `releases/0.1.18/manifest.json`），1128 字节，
SHA-256 `3335f529a2f01aa3cb373fcceb726382563cc1af012eb9973a053e80dfa60135`，Ed25519 签名验证通过，
`artifacts` 含 `win32/x64:429906274` 与 `darwin/arm64:141972388` 两条。

发布后实测：公网清单 200 / 1128 字节且哈希一致；DMG 与 EXE 均 200 且 `content-length` 与清单一致。

## 回滚

把 0.1.17 的清单重新 deploy 到 `releases/stable/manifest.json` 即可（800 字节，
SHA-256 `f114a3e631b2984fb1a1118df64d2f8af69f4e80213a20335a49b972bf241087`）；0.1.18 的产物留在
`releases/0.1.18/` 不影响回滚。
