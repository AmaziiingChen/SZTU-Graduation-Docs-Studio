# Windows 0.1.8 构建与更新下载验收

2026-10-08。按用户要求，仅构建与检查，不运行安装程序、不覆盖本机 0.1.6，不访问真实学生工作区。

## 构建产物

- 应用源码：`683e27f460b18de48deb582d4d64f11f9fa81b35`。
- 模板源码：`11adc1762effb35017a29b4a0e149c8a2ee4a36e`。
- 命令：`pnpm package:win:offline`，退出码 0。
- 安装包：`release/offline/SZTU-Docs-Studio-0.1.8-win-x64-offline.exe`。
- 大小：376935364 字节。
- SHA-256：`b7b0b95782595536753f6a1c94218c411c5d0a964942088966bbc59ac6fa14da`。
- Windows Authenticode：NotSigned。打包日志中出现 signtool 步骤不代表已取得签名。
- 打包重新生成论文 ZIP 与配套哈希文件，已保留本地变化。

## 自动验证

- 桌面测试 606 项、管理端测试 13 项、更新清单工具测试 4 项通过。
- 后端运行 258 项，8 项跳过，结果 OK；lint 无错误但有现存警告。
- 前端与管理端构建、离线运行时、冻结后端、模板资源完整性检查通过。
- 使用最终包内 sidecar，排除系统 Python/TeX/Poppler PATH，在独立合成工作区完成七类文档预览及 Word/PDF 导出，共 11 页。
- 本机 0.1.6 包内引擎创建的合成草稿可由新版恢复；这不等同于已执行覆盖安装验收。
- 七类 PDF 的 CJK 字形门禁通过。本轮未做逐页版式复核或 Word/WPS 验收。
- 证据：`build-package-offline-0.1.8.log`、`build-acceptance-0.1.8.log`、`build-glyph-0.1.8.log`、`tmp/windows-acceptance-0.1.8/acceptance.json`。

## 云端与人工测试

Windows 已安装 CloudBase CLI 3.8.5，并通过用户浏览器授权，环境 Amazing APP 可访问。

构建时线上 stable 清单为 0.1.8，但只有 darwin/arm64。Windows 包必须上传至版本化地址，再用与客户端固定公钥匹配的原 Ed25519 私钥签署含两个平台的清单。发布前重新读取线上清单，防止覆盖 macOS 的并行更新。保留原更新策略和 macOS 资源，不使用测试私钥替代生产密钥。

安装包已上传：`releases/0.1.8/SZTU-Docs-Studio-0.1.8-win-x64-offline.exe`。CLI 返回上传成功，但 `verified: false`，因此另行通过公网完整下载到 `tmp/windows-acceptance-0.1.8/downloaded-installer.exe`，实际 SHA-256 与本地产物一致。上传记录在 `build-upload-0.1.8.log`。

用户已迁移原发布私钥，派生公钥与旧版固定公钥一致。已验证原线上签名、保存清单备份，保留 macOS 资源和原更新策略，追加 win32/x64 资源后重新签署并发布 stable 清单。公网回读签名通过，包含两个平台。使用本机已安装 0.1.6 的公开配置与当前客户端更新模块，以 Windows x64 / 当前版本 0.1.6 请求真实线上清单，返回 `available / 0.1.8 / 376935364`。证据在 `tmp/windows-acceptance-0.1.8/online-update-check.json`，发布前清单备份为同目录 `stable-before-publish.json`。

用户仍需自行用已安装旧版验证通知界面和实际客户端下载，下载完成后可暂不执行安装。本轮未运行安装程序。

首次安装到干净 Windows、实际覆盖升级、卸载、桌面交互及外部编辑器验收均未在本轮执行。
