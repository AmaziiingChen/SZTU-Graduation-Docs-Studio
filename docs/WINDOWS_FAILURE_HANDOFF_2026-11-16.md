# Windows 0.1.14 故障排查与诊断补全交接

交接日期：2026-11-16，北京时间。接手目标是先解决已收到的 Windows 预览失败，补齐能解释底层失败原因的证据，再处理跨平台更新下载。不要把下一次公开发布当作采集信息的试验。

2026-11-16 后续验证：任务书报告 `d67e88f0-497c-4f8d-a6e6-00ea96959d1f` 对应的环境处理缺陷已完成旧版/候选版实际 Windows 对照，旧版复现同一错误，候选版同条件通过；生产诊断 ZIP 已完整读回。详见 [验证记录](evidence/WINDOWS_TASK_BOOK_FIX_0.1.15.md)。以下保留当时原始证据；中文路径的另一份故障仍单独待处理。

## 接手状态与代码基线

- 应用仓库：[SZTU-Graduation-Docs-Studio](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio)，分支 `codex/thesis-workbench`。本次交接前远端最新提交为 `6d0ada287610863c4484dbb2a7d0da77e07c7203`，已包含 Windows 0.1.14 发布记录。
- 模板仓库：[SZTU-Thesis-Latex-Template](https://github.com/AmaziiingChen/SZTU-Thesis-Latex-Template)，同分支，提交 `35f4b0ffc97fce5ebe36fc58a962da9138370386`。两个仓库并列，模板目录名为 `Thesis`。
- 当前公开稳定更新清单已经是双平台 `0.1.14`。此前“Windows 尚未上传、清单仍为 0.1.13”的描述已过时。
- 本交接初稿只整理证据；随后已增加共享渲染环境对 COMSPEC 缺失、系统 PATH 未展开的修复，以及 GitHub 双系统原生构建与安装包验收。当前验证结果见 [云端构建与安装包验收](CI_ACCEPTANCE.md)。初稿中的现场根因判断仍以原始证据为界，不能推定原用户电脑已确认修复。
- 现有 [Windows 0.1.14 验收记录](evidence/WINDOWS_ACCEPTANCE_0.1.14.md) 说明构建机曾成功运行；不能据此推断以下用户环境已覆盖。

在 Windows 的共同父目录运行。先检查本机改动，已有未提交内容应保留；分支分叉时检查差异，不强制覆盖。

```powershell
git -C SZTU-Graduation-Docs-Studio status --short
git -C Thesis status --short
git -C SZTU-Graduation-Docs-Studio switch codex/thesis-workbench
git -C SZTU-Graduation-Docs-Studio pull --ff-only origin codex/thesis-workbench
git -C Thesis switch codex/thesis-workbench
git -C Thesis pull --ff-only origin codex/thesis-workbench
git -C SZTU-Graduation-Docs-Studio rev-parse HEAD
git -C Thesis rev-parse HEAD
```

## 第一优先：今天的任务书预览失败

### 已核实的线上证据

| 项目 | 值 |
| --- | --- |
| 报告编号 | `d67e88f0-497c-4f8d-a6e6-00ea96959d1f` |
| 云端接收时间 | 2026-11-16 09:22:49.993478 +08 |
| 云端到期时间 | 2026-12-16 09:22:49.993478 +08 |
| ZIP 大小 | 113822 字节 |
| ZIP SHA-256 | `458b8ecc2107f0c09dde906dca4a3c07a0cf6312aa09223f64322fe1518b0169` |
| 平台 | Windows 10，10.0.19045，AMD64 |
| 应用版本 | 0.1.14 |
| 冻结引擎 SHA-256 | `a213a46a9115ee57a8ea66fab624c36ff664ae6f0e28af786b09348656bd64db` |
| 文档类型 | `task_book`，操作 `preview.generate` |
| 内置模板版本 | `0.2+workspace.8a8e13a97661` |
| 运行时标识前缀 | `bdb4c8e1ac7053a7` |

macOS 维护端已从生产数据库读回原 ZIP，并重新计算 SHA-256，与表内值一致。以下来自原包，不是模拟日志。

步骤记录证明 `snapshot`、`template`、`content_validation`、`render_input_write` 已成功。随后 `pdf_compile` 失败：XeLaTeX 退出码 1，外层 Python 渲染程序退出码 2，总操作约 5.3 秒。字体和宏包已经加载，错误出现在第一页输出阶段。

`render-work/latex/main.log` 和 `tools/001/stdout.bin` 都包含：

```text
[1
! I can't write on file `main.pdf'.
Please type another file name for output
! Emergency stop.
l.296 \clearpage
No pages of output.
```

包中有原始输入、档案、模板源码、生成 TeX、53 KB 的 `main.log`、约 21 KB 的原始标准输出和外层异常栈。`engine-stderr.bin` 为 0 字节，不能解释为“没有收集日志”；本次编译日志主要在上述文件。没有生成 PDF，也尚未进入 PDF 结构检查或预览转图阶段。`main.aux` 和日志已写出，因此不能仅凭报错断言整个临时目录不可写。

### 高优先假设及证据边界

1. `backend/src/sztu_docs_backend/exporter.py` 的 `_renderer_environment()` 使用环境变量允许清单，**未保留 `COMSPEC`**。这是已确认的代码行为。
2. 用户此次 `tools/001/invocation.json` 的有效环境也没有 `COMSPEC`。其 `PATH` 包含字面值 `%SystemRoot%\\system32`、`%SystemRoot%`，没有对应的已展开系统路径。这是已确认的现场数据。
3. `backend/src/sztu_docs_backend/runtime_paths.py` 的 `windows_tool_path()` 目前仅尝试短路径转换，没有展开 `%变量%`。
4. XeTeX 的 Windows PDF 输出实现通过 `_wpopen` 启动 `xdvipdfmx` 并建立管道。该调用失败可以表现为无法写入 PDF；不能把错误字面含义直接等同于目录权限问题。参考 [XeTeX 源码](https://github.com/TeX-Live/texlive-source/blob/trunk/texk/web2c/xetexdir/XeTeX_ext.c#L2462) 和 [Microsoft `_popen/_wpopen` 文档](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/popen-wpopen)。上游源码解释机制，不等于已调试用户那份二进制。

**目前最值得验证的假设是：软件裁剪了命令解释器环境，同时没有规范化系统搜索路径，导致 PDF 输出子进程启动失败。** 尚未取得该底层调用的 `errno` / Win32 错误码，不能宣称这是已证实的唯一根因，也不能宣称添加一个变量就已修好。先由维护端复现和验证，不要求用户换电脑或反复装试验版。

### 旧验收为何没有挡住

`scripts/accept_windows_bundle.py` 的 `Sidecar.__init__()` 主动将真实 `SYSTEMROOT/System32` 加入 PATH。`scripts/verify_windows_offline_runtime.py` 也采用已补齐的系统路径。生产入口 `apps/desktop/electron/sidecar-client.ts` 的 `resolveSidecarPath()` 在 Windows 上没有同等处理。

因此，这些检查能证明构建机上补齐路径后的流程可运行，不能证明应用从用户真实环境启动时可运行。新增验收必须覆盖正式入口，记录进入测试前和软件处理后的有效环境，不能让测试准备步骤悄悄补掉待测故障。

### 建议的复现与修复顺序

1. 使用独立合成工作区，先用当前 0.1.14 正式资源复现，再改变环境。保留原包、运行时和应用哈希。不要打开或写入用户正在使用的数据库。
2. 在**单个测试进程**中构造：`COMSPEC` 缺失，系统 PATH 仅含未展开的 `%SystemRoot%`；保留可访问的内置 TeX/Poppler 路径。不得改系统全局环境。对照正常已展开系统路径。
3. 分别测试最小合成 TeX、真实任务书模板、应用 Electron → 冻结 Python → 模板 → XeLaTeX 的整条链路。记录命令解释器和 `xdvipdfmx.exe` 的实际定位结果、进程启动结果及原始错误。
4. 验证保留/补齐合法的命令解释器路径，以及正确展开系统目录后，是否消除同一故障。若失败仍在，继续定位实际失败调用，不套用当前假设。
5. 评估共享 Windows 运行环境构造的位置，避免 Electron 与 Python 各有一份不一致的修补。保留已批准的工具优先级，系统目录按实际 `SYSTEMROOT` 解析，不硬编码用户路径。
6. 如果 XeLaTeX 内部仍吞掉关键系统错误，评估受控地分开 XDV 生成与 PDF 转换，分别捕获真实命令、两路输出和退出码。须以当前模板功能和输出一致性验证为依据，不能只为日志方便就更改渲染语义。

## 第二个独立故障：中文用户路径下找不到格式文件

| 项目 | 值 |
| --- | --- |
| 报告编号 | `fc98a6f6-af8e-434d-bdc3-584cbea835ac` |
| 云端接收时间 | 2026-11-15 23:01:44.466836 +08 |
| 云端到期时间 | 2026-12-15 23:01:44.466836 +08 |
| ZIP 大小 | 75436 字节 |
| ZIP SHA-256 | `be219f5c17ded7976de41845f034d0a286ea169e0bbc71e1a9bc6b259e201be4` |
| 平台、应用 | Windows 11，10.0.26200，AMD64；0.1.14 |
| 操作 | 开题报告 `preview.generate` |
| 内置模板版本 | `0.3+workspace.0e33d7fb0bbb` |

该包也已完整读回并核对哈希。其用户目录包含中文。现有短路径转换后，用户目录层级仍含中文。日志包含：

```text
kpathsea: configuration file texmf.cnf not found in these directories
no appropriate script or program found: fmtutil
I can't find the format file `xelatex.fmt'!
```

这次失败发生在编译初始化，尚未到第一页 PDF 输出，不能和上一份报告归为同一个原因。日志中的乱码也不能直接当作磁盘文件名真的乱码；保留原始字节并核对 Windows 本地编码。

重点核查 `TEXMFROOT`、`TEXMFCNF`、实际格式文件和配置文件、TeX 对 Unicode 路径的读取能力、短路径是否真实可用。不能以“尝试了短路径转换”代替“结果已经是可用 ASCII 路径”。对照 `scripts/stage_windows_offline_runtime.py`、`scripts/prepare_windows_runtime_installer.py`、`scripts/windows_bundle_runtime.py` 和 `apps/desktop/electron/offline-runtime.ts`。不因中文用户名就要求用户改系统用户名。

## 诊断补全与验收要求

用户既有决定继续有效：**「创建诊断包」直接创建完整诊断包**。用户先看到原始信息范围和清单，自愿保存或发送，不另设「查看完整故障包」入口。完整包允许含本次操作的原文、档案、素材、路径、原始日志；原始用户包不得提交到 GitHub。

本次暴露的缺口是，虽然已有步骤和编译日志，**输出子进程启动失败的底层原因仍不可见**。要让报告能区分配置文件定位、工具定位、子进程创建、编译、PDF 转换、PDF 检查、转图、最终写入等环节。

每次外部工具调用至少保存实际可执行路径、参数、工作目录、有效运行环境、开始/结束时间、PID、是否成功创建进程、退出码/信号、原始 stdout/stderr；启动失败要保存原异常、系统错误码和发生调用。对于第三方进程内部没有输出的原因，明确标记未获得，不把推测填成实测结果。

结合本次故障建立内部回归，优先复用已有测试和合成样本：

| 场景 | 必须能从保存/云端回读的包中判断 |
| --- | --- |
| 正常环境下七类过程文档 | 实际预览、PDF/Word 导出完成，产物与输入对应 |
| COMSPEC 缺失、系统 PATH 含变量、系统目录缺失 | 真实入口是否修复有效环境；失败发生在哪次进程启动 |
| 中文用户名、空格路径、短路径不可用 | 工具/配置/格式文件实际路径及哪个定位失败 |
| xelatex.fmt 或 texmf.cnf 不可用 | 不是笼统 RENDER_FAILED；保留工具原始输出和具体缺失项 |
| PDF 转换工具缺失或启动失败 | 与 TeX 输入错误、目录写入错误区分；保留启动错误 |
| 输出不可写、目标占用、空间不足 | 哪个文件、哪个操作失败；系统错误/探测结果不能虚构 |
| PDF 结构检查或转图失败 | 编译是否完成、原 PDF、具体工具输出和退出记录 |
| 引擎启动失败、崩溃、超时、协议异常 | 同一案例内保留可关联的最后步骤与原始字节 |
| 多档案、多请求、取消/重试 | 输入、输出、日志及报告编号不串档；模糊归属明确说明 |
| 日志/素材采集失败、截断、打包或上传失败 | 清单说明具体缺失；失败不能显示发送成功 |

入口和现有测试：

- `backend/src/sztu_docs_backend/full_diagnostics.py`、`diagnostic_steps.py`、`exporter.py`、`protocol.py`。
- `apps/desktop/electron/sidecar-client.ts`、`full-diagnostics.ts`、`diagnostics.ts`，前端 `diagnostic-support.tsx`。
- `backend/tests/test_runtime_paths.py`、`test_environment.py`、`test_full_diagnostics.py`、`test_diagnostic_details.py`。
- `apps/desktop/tests/full-diagnostics.test.ts`、`diagnostics.test.ts`、`offline-runtime.test.ts`。

已知边界要保留并如实展示：本地原始包最多保留 48 小时、最近 5 个失败案例；云端 30 天；当前上传上限 8 MiB，超限可保存本地；启动 stderr 上限 256 KiB，异常协议片段上限 1 MiB；不能确定归属的并发输出不应混入其他档案。`missing: []` 仅表示已安排的采集没有报缺失，不能证明所有潜在系统原因都已采集。

内部构建的合成故障必须走**实际应用生成 → 保存 ZIP → 主动发送 → 生产接收回执 → 按编号读回原 ZIP → 校验大小及 SHA-256 → 从包独立指出失败调用和原因**。本地接收器通过不能代替线上验收，正常流程通过不能代替故障注入测试。测试不需要让真实用户提交新的材料。

## 在 Windows 取回现有原始包

环境为 `amazingapp-d5giro9ac73398410`，上海。用维护者已授权的 CloudBase 工具读取 `public.full_diagnostic_reports`。不要把服务端密钥放到客户端或交接文档中。

先查元数据：

```sql
SELECT report_id, received_at, expires_at, sha256,
       octet_length(decode(archive_base64, 'base64')) AS archive_bytes
FROM public.full_diagnostic_reports
WHERE report_id IN (
  'd67e88f0-497c-4f8d-a6e6-00ea96959d1f',
  'fc98a6f6-af8e-434d-bdc3-584cbea835ac'
);
```

再逐份读取 `archive_base64` 与 `sha256`，由工具直接解码保存到本机忽略目录 `tmp/`，不要在聊天中打印整包。按本文件记录的哈希核验后，只提取需要检查的文件，避免盲目解压不可信路径。两份 ZIP 含真实材料，仅作维护排查。macOS 端的临时副本已清理，云端原包仍在上述保留期内。

## 后续任务：跨平台更新下载

本项已复现，先完成预览故障定位再处理，不阻塞上面的工作。

- `apps/desktop/electron/update-service.ts` 的 `downloadArtifact()` 把整段下载包在 `fetchWithTimeout(artifact.url, 60_000, ...)` 中。60 秒是整个传输的总期限，不是空闲超时，也不是文件校验要求。
- 2026-11-16 实测两个正式文件地址均 HTTP 200，下载约 100～170 KB/s。用现有实际 `UpdateService` 从 0.1.13 检查正式清单，验签成功并发现 0.1.14；下载约 60.02 秒、约 10.2 MB 后失败，状态变为 `available`、`downloadFailed: true`。
- macOS 包 138037789 字节，Windows 包 429438195 字节，当前速度下远超一分钟。当前实现重试重新下载，没有断点续传。
- 超时发生时外层先返回，临时文件清理可能还在进行；不要只在返回瞬间看到 `.tmp` 就认定永久泄漏。
- 下载服务当前使用默认 `*.tcloudbaseapp.com` 域名。腾讯云环境及静态托管状态正常，体验套餐有效至 2027-02-28；查询时本月已统计 353.42/3000 资源点。没有欠费停服证据。慢速现象已实测；具体是否为平台固定限速尚未证明。

修复应区分连接超时、持续无数据超时和整体耗时；只要持续收到有效数据，不能在 60 秒强行失败。续传必须验证服务器实际返回 206、范围及内容身份；本次探测带 Range 时服务仍返回 200 全包，必须正确回退，不能把全包追加到部分文件。保持签名清单、平台、长度、SHA-256 校验，只有完整校验后才能显示可安装。

相关回归在 `apps/desktop/tests/update-service-regressions.test.ts`。补充持续传输超过一分钟仍成功、真正停滞可重试、中断恢复、Range 不支持/文件变更、哈希失败和磁盘写入失败。至少用实际安装包内的更新模块跑一次受控慢速 HTTPS 完整传输；模拟计时器只作单测。不要仅把总时限加大后就发布。

## 开发、验证与交回结果

先按 [Windows 开发与打包](WINDOWS_DEVELOPMENT.md) 复用现有 Node.js 24、pnpm 11.19.0、Python 3.11+ 和 Windows 本机依赖，不跨系统复用 macOS 的 `.venv`、`node_modules`。

```powershell
Set-Location SZTU-Graduation-Docs-Studio
pnpm install --frozen-lockfile
pnpm setup:backend
pnpm dev
```

先修复和运行相关测试，再跑全量检查。以下命令本身不生成安装包：

```powershell
pnpm --filter @sztu-docs/desktop exec vitest run tests/full-diagnostics.test.ts tests/diagnostics.test.ts tests/offline-runtime.test.ts tests/update-service-regressions.test.ts
pnpm test:backend
pnpm verify
```

开发版通过后，还需内部安装包验证冻结引擎和实际入口；公开发布另按用户当时的决定执行。构建与原有包内检查可参考 [0.1.14 构建交接](RELEASE_HANDOFF_0.1.14_WINDOWS.md)。保留原有检查，但不能用它替代本文件提出的现场环境与正式入口回归。

交回结果至少应包括：

1. 两个仓库提交号、内部构建版本/哈希、运行时哈希，以及 Windows 测试环境。
2. 每个故障的“复现前提 → 实际失败调用 → 修复 → 同环境修复后结果”，已证明与仍待证明分开写。
3. 正常流程和故障矩阵的实测证据；每个案例使用新的隔离工作区，保留失败原始材料。
4. 至少一份内部合成故障包的生产回执和原 ZIP 回读校验，说明独立排查者能据此定位到什么程度。
5. PDF 内容提取、中文字形、逐页版式和 Word/WPS 验证分别记录。Windows 工具链修复通过不等于文档版式已验收。

本次接手不以真实用户换电脑、反复重装或提交新报告作为首个验证步骤。先把已有证据和维护端可构造的环境用足，避免让用户继续承担内部测试成本。
