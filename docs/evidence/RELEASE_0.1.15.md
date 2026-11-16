# 0.1.15 发布与验证记录

2026-11-16 15:56（北京时间），腾讯云正式更新清单已切换到 0.1.15。复用现有静态托管、签名密钥和安装包验收流程。

## 本次修复

Windows 渲染进程保留并补齐 COMSPEC/PATHEXT，展开 PATH 中的系统目录变量，补齐合法 System32 路径。旧版在相同故障环境下通过环境检查，随后任务书 `pdf_compile` 失败；候选修复版同条件成功生成 4 页预览。原用户诊断中的引擎哈希与对照使用的公开旧版一致。详见 [旧版与新版对照证据](WINDOWS_TASK_BOOK_FIX_0.1.15.md)。

原用户电脑尚未远程复测。此次确认修复的是对照中实际重现的环境处理缺陷，不代表全部 Windows 故障均已解决。

## 最终安装包

| 平台 | 文件大小（字节） | SHA-256 |
| --- | ---: | --- |
| macOS ARM64 DMG | 141985867 | `8cfbee56184faa5f93a38fc0550a129f81ac12f731227920b5f6e252519790e4` |
| Windows x64 离线 EXE | 428905297 | `305d0b1cac7bc28d3f60bcd86bfb4a5e26d6d208e0064d174e7e178e333f71b8` |

- [下载 macOS ARM64](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/0.1.15/SZTU-Docs-Studio-0.1.15-mac-arm64.dmg)
- [下载 Windows x64 离线包](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/0.1.15/SZTU-Docs-Studio-0.1.15-win-x64-offline.exe)
- [已签名正式更新清单](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/stable/manifest.json)
- [本版清单存档](https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com/releases/0.1.15/manifest.json)

Mac 包源自 `c3e8b03ba9fb92f80f5507f9f9ca2f3b8caed5df`，Windows 包源自 `6bec77892256dc623cd7898f2953ba6ce368d4fb`。两者之间仅修改现有验收 workflow 和离线打包配置：消除 electron-builder 继承配置重复复制同一资源引起的 Windows EBUSY；应用、后端、模板与 Mac 打包公共资源无差异，因此保留已验收的 Mac 产物。模板基线 `35f4b0ffc97fce5ebe36fc58a962da9138370386`。

## 验证

- [真实 Windows 旧版/候选版对照](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43815700322)：旧版正常环境通过；旧版故障环境复现 `main.pdf` 输出失败；修复版同环境通过。
- [最终 Windows 安装包验收](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43819341133)：实际静默安装，执行包内冻结引擎；7 类文档预览及 Word/PDF 导出通过，共 11 页；COMSPEC 缺失和未展开系统 PATH 的任务书预览通过；2 类故障采集通过。
- [最终 macOS 安装包验收作业](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43816674081/job/133130191922)：从实际 DMG 执行包内冻结引擎，7 类文档预览及 Word/PDF 导出通过，共 11 页；2 类故障采集通过。引用的是成功的 Mac 作业，整个运行中的 Windows 初次打包失败已由后续 Windows 运行解决。
- [最终代码基础检查](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/43819338019)：通过。
- 两个平台均完成内容提取与中文字形检查；未作逐页人工版式检查、Word/WPS 目标编辑器验收。

两份安装包上传完成后，分别核对腾讯云对象长度和整包 CRC64：Mac 为 `4025937646608933975`，Windows 为 `9984300607227952507`，与本地整包计算一致。公开下载地址 HTTP 200、长度正确、首 1 MiB 与本地一致。SHA-256 由实际验收产物计算，写入签名清单。

更新清单使用既有 Ed25519 密钥签名，保留原推荐更新策略与正常服务状态。维护端使用已验收安装包内实际 UpdateService 模块访问正式地址，验证远端签名和清单与本地一致：Windows/macOS 的版本号设为 0.1.14 时均返回 `available: 0.1.15`；设为 0.1.15 时均返回 `up_to_date`。这是实际线上查询，未模拟网络，也未代替用户电脑自动下载测试。

## 腾讯云诊断生产入库

Windows 对照运行产生的报告 `fd80c318-05b2-4f1d-85ba-addcb414b696` 已直接从 Windows 经真实包内发送模块提交生产端，维护端完整读回并逐字节一致，见对照证据。

最终 Windows 0.1.15 安装包另外产生合成编译失败包 `dde63be3-eb0a-4f40-a60c-ec66731fd428`；维护端运行真实包内 FullDiagnostics 发送模块提交生产端，再通过 CloudBase PG 完整读取 ZIP：

- 接收时间：2026-11-16 15:15:51.293853 +08；到期时间：2026-12-16 15:15:51.293853 +08。
- 91984 字节，50 个文件，缺失列表为空。
- SHA-256：`b861909c095fbc1127170d294b03cbf7afb40193f35cc721abca14cb728dbbce`，读回逐字节一致。
- 保留应用版本 0.1.15、具体失败步骤 `pdf_compile` 和原始故障标记。最终包的提交动作在维护端完成，故障包生成动作在 Windows 完成。

上述生产入库读回与 CI 中的本地回环接收测试分别记录；未将回环成功当作腾讯云接通证据。私有正文、原始诊断 ZIP、字体和密钥未进入 Git。

## 仍需单独处理

- 中文用户路径下 `texmf.cnf` / `xelatex.fmt` 定位失败是另一份已知报告，未纳入本次修复。
- 安装包自动下载的整体 60 秒限制仍存在，本版未更改。慢网下载失败时可用上述浏览器下载地址安装；本版不宣称已修复自动下载超时。

本地安装包及原始验收、线上读回记录保留在 `tmp/release-0.1.15/`，不进入 Git。旧正式清单保留为该目录的 `previous-manifest.json`，用于必要时恢复。
