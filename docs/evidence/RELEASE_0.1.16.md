# 0.1.16 修复与验证记录

2026-11-18，候选版本 0.1.16 已完成代码、测试与双平台安装包验收。本文只记录已经实测到的结果；发布清单尚未切换，`releases/stable/manifest.json` 仍是 0.1.15。

## 本次修复

1. **编译环境改到机器级 ASCII 目录。** 引擎根从 `%LOCALAPPDATA%\SZTU-Docs\r\<id16>` 迁到 `%ProgramData%\SZTU-Docs\engine\<id16>`，安装器写 `complete.txt`、只给 `texlive\texmf-var` 与 `texlive\texmf-config` 授 `Users:(OI)(CI)M`，避免把二进制设成跨用户可写。运行时描述符升级到 schema 3.0，带有序回退链：`%SZTU_ENGINE_ROOT%` → `%ProgramData%\SZTU-Docs\engine\<id16>` → legacy `%LOCALAPPDATA%\SZTU-Docs\r\<id16>`（沿用旧目录时同样要求纯 ASCII）。ASCII 老用户只更新应用、不重跑安装器时继续可用。
2. **拒绝而非误判非 ASCII 引擎根。** 后端 `portable_tex_root()` 与桌面端 `offlineRuntimePaths()` 在解析到非 ASCII 根时直接报错（`"outside an ASCII path"` / `ENV_TEX_PATH_UNSUPPORTED`），不再退化成笼统的 `RENDER_FAILED` 或"安装不完整"。
3. **环境检查改为真实编译探针。** `_check_xelatex()` 不再只查 `shutil.which`，而是在临时目录编译一份最小文档，按输出分类 `ENV_TEX_OK` / `ENV_TEX_MISSING` / `ENV_TEX_PATH_UNSUPPORTED` / `ENV_TEX_CONFIG_MISSING` / `ENV_TEX_FORMAT_MISSING` / `ENV_TEX_LAUNCH_FAILED` / `ENV_TEX_FAILED`；错误码放在 `details.code`，不改契约 schema。本机实测探针 0.38 s。
4. **诊断补全。** `tool_source` 改由引擎根标记判定（`bundled_tool_root()`，沿可执行文件父目录找同时含 `runtime-manifest.json` 与 `texlive/` 的目录），不再靠路径片段白名单；`runtime.json` 增加 `engine` 段（`root`/`ascii`/`texmf_cnf`/`xelatex_fmt`/`configuration`）；Windows 工具输出改用 `decode_tool_output()`（UTF-8 → GB18030 → 替换），中文用户名不再变成 `C:\Users\������`。
5. **下载不再被整包 60 秒掐断。** `update-service.ts` 改为连接超时 30 s + 无进度超时 45 s，持续到达的字节会不断重置计时。

提交：`1688166`（主修复）、`668fe92`（Windows 假时钟测试修正）、`e104209`（中文用户名验收工作流，`exp/chinese-profile` 实验分支）。

## 根因证据

实验分支 `exp/engine-path-probe` 的探针作业 [44121849135](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/44121849135) 在 `windows-2025` 上同条件对照：

| 用例 | 引擎根 | 输出目录 | 结果 |
| --- | --- | --- | --- |
| A | ASCII | ASCII | 成功，PDF 3455 B |
| B | ASCII | 含中文 | 成功，PDF 3455 B |
| C | 中文（`探针引擎`，目录联接指向真实引擎） | ASCII | 失败，`I can't find the format file 'xelatex.fmt'!`，kpathsea 报 `texmf.cnf not found`，路径显示为 `??????????` |
| D | 中文长目录（10 字） | ASCII | 同 C 失败；两种中文目录的 `GetShortPathNameW` 都返回未生成别名 |

结论：kpathsea 按 ANSI 有损转换非 ASCII 路径，中文变成 `?`，`texmf.cnf` 与 `xelatex.fmt` 因此找不到；与 8.3 短名是否存在无关。中文**输出**目录可用，所以这次只搬引擎根，不搬工作目录。用户 0.1.15 诊断包（`2dd9f424-918e-4deb-8c64-540c2577a77e`）的失败行与用例 C 逐字相同。

## 最终安装包

| 平台 | 文件大小（字节） | SHA-256 |
| --- | ---: | --- |
| macOS ARM64 DMG | 141964177 | `4661527875e8957b551ed2bfe3fad2ac4c96a3a683f0276f59ff54dca0555a37` |
| macOS ARM64 ZIP | 141704149 | `986eff4e435c4a05fda68d82b31f79aa805bb6af7a5b19c2de494e68ac1d229b` |
| Windows x64 离线 EXE | 428910318 | `e0341d771be00a6158f108390bb957852ced9520b7b43aa01f76c9eb57744ce0` |

产物来自验收作业本身的内部安装包附件（commit `668fe9281fcc333acf47d0c87d08f36256ee93b0`），SHA-256 由本机对下载后的完整文件计算。模板基线 `35f4b0ffc97fce5ebe36fc58a962da9138370386`。

## 验证

- [代码基础检查 44128350297](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/44128350297)：`Checks / windows-2025` 与 `Checks / macos-15` 均 success。Windows 上跑通 `pnpm verify`（桌面端 643 个测试、telemetry、后端 301 个测试、lint 0 error）。
- [安装包验收 44128349984](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/44128349984)：`Package and exercise / windows-2025` 与 `Package and exercise / macos-15` 均 success。
  - Windows：实际静默安装到临时目录，执行包内冻结引擎，7 类文档全部通过（proposal 2 页、task_book 3 页、midterm 2 页、advisor_review / reviewer_review / defense_record / grade_assessment 各 1 页，合计 11 页），`missing_comspec` 与 `unexpanded_system_path` 回归均 pass，合成故障采集两例（11 文件 / 50 文件）回读一致。
  - Windows 安装后的 `runtime.json` 记录 `engine.root = C:\ProgramData\SZTU-Docs\engine\bdb4c8e1ac7053a7\texlive`，`ascii: true`、`texmf_cnf: true`、`xelatex_fmt: true`、`TEXMFROOT`/`TEXMFCNF` 均已设置；同一份诊断的 `pdf_compile` 阶段 `tool_source` 为 `bundled`（旧白名单逻辑会误标成 `system`）。
  - macOS：从 DMG 挂载后执行包内引擎，同样 7 类文档、11 页，逐份中文字形检查通过。
- 两份 `acceptance.json` 的 `status` 均为 `pass`，`version` 均为 `0.1.16`。CI 验收只走本机回环，不向生产云上传（`production_cloud_verified: false`）。

## 候选发布清单（已生成，未上传）

用仓库自带的 `scripts/create_update_manifest.mjs` 以既有 Ed25519 私钥签了一份 0.1.16 候选清单，沿用当前推荐更新策略（`update_policy: recommended`、`service_status: normal`、无最低版本、无公告）：

- 文件：`handoff/SZTU-接管-2026-11-17/候选清单-0.1.16/manifest.candidate.json`，1128 字节，SHA-256 `92251da1212377f1735ef4b3eb10c1356def76ed541c24b70755c55673729f05`
- 用固定公钥（`config/remote-services.production.json` 的 `update_public_key_pem`）按 `update-service.ts` 的 `canonicalJson` 规则验签：`valid: true`，ed25519，签名 64 字节，`schema_version 2.0`、`channel stable`、`version 0.1.16`，两个产物字节数与 SHA-256 与本地整包一致。
- `published_at` 是签名当时的时间，正式发布时会重新生成，`releases/stable/manifest.json` 目前仍是 0.1.15，未做任何上传。

## 尚未完成

- **中文用户名与非管理员安装的端到端验收还没跑成。** 工作流 `.github/workflows/chinese-profile-acceptance.yml` 已写好：创建名为 `林振宇` 的标准用户，用计划任务以该账号静默安装并跑完整验收，再断言引擎落在 `C:\ProgramData`、路径逐字符 ASCII、legacy 用户目录未被使用。第一次运行（[44128583611](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/44128583611)）在等待阶段超时，未留下阶段标记；已补上逐阶段标记与超时现场转储。之后两次尝试（[44143655472](https://github.com/AmaziiingChen/SZTU-Graduation-Docs-Studio/actions/runs/44143655472) 与 44148170560）都是作业未启动即失败，注解一致为 "The job was not started because recent account payments have failed or your spending limit needs to be increased"，属账号计费问题，与代码无关。这条验收因此仍是缺口，需要在计费恢复后重跑，或在真实中文用户名 Windows 机器上手工执行 —— 后者所需的安装包与 `verify-engine.ps1` 自动核对脚本已放在 `handoff/SZTU-接管-2026-11-17/候选安装包-0.1.16/`。
- **多账户安装限制**：引擎安装在机器级目录，由第一个完成安装的账户拥有；换另一个 Windows 账户再装一次会因写权限不足失败（不会破坏已有安装）。单人使用的学生电脑不受影响，但若要支持多账户，需要安装器在进入解压前先探测可写性并给出明确提示。
- 安装包验收只做内容提取与中文字形检查，**未做逐页人工版式检查，也未做 Word/WPS 目标编辑器验收**。
- 生产云端入库核对只覆盖了诊断报告读取（见接管计划目录下的只读核查结果），发布链路本身尚未执行。

## 发布步骤（待明确授权后执行）

1. 用既有 Ed25519 私钥签发 0.1.16 清单，保留原推荐更新策略。
2. 上传 DMG、ZIP、EXE 到 `releases/0.1.16/`，核对对象长度与 CRC64，与本地整包比较。
3. 切换 `releases/stable/manifest.json`，再用已装 0.1.15 的 UpdateService 模块实际查询新旧版本返回。
4. 公开下载地址 HTTP 200、长度、首 1 MiB 与本地一致。
