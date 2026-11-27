# 0.2.0 发布记录

发布对象：Windows x64 离线安装包（`SZTU-Docs-Studio-0.2.0-win-x64-offline.exe`）。

- 文件大小：449,028,286 B（428.2 MiB）
- SHA-256：`85aa451dfe0707619a15a0b46024194ee5b305d8ded78e09fa038abbddac644d`
- 下载页：`https://docs.amaziiiing.com/download/`
- 安装包：`https://docs.amaziiiing.com/releases/0.2.0/SZTU-Docs-Studio-0.2.0-win-x64-offline.exe`
- 更新清单（schema 2.0，服务 0.1.13 起的旧客户端）：`https://docs.amaziiiing.com/releases/stable/manifest.json`
- 更新清单（schema 3.0，含应用内消息，0.1.16 起）：`https://docs.amaziiiing.com/releases/stable/manifest-v3.json`
- 旧测试域名 `https://amazingapp-d5giro9ac73398410-1412347033.tcloudbaseapp.com` 继续提供同一份文件，只作为镜像。
- 自定义域名：`docs.amaziiiing.com` 绑定到 CloudBase HTTP 访问服务（`/` 路由转发 `STATIC_STORE`），证书 `cgFGC7lM`（TrustAsia DV，2027-02-25 到期）。
- 签名：两份清单均用 Ed25519 私钥 `~/.sztu-docs-release/update-private.pem` 签名，公钥与客户端内置值一致。

## 主要变化

### 1. 模板字体全部随包内置，首次启动自动注册

- 打包前由 `scripts/stage_document_fonts.py` 把模板需要的 11 个字体文件收进 `local-fonts/`（约 65.5 MB）：
  宋体、黑体、楷体、Times New Roman 四款、华文中宋、华文行楷、方正小标宋与 Wingdings 2。
- 普通与离线打包配置都把整个 `local-fonts/` 复制到 `resources/document-fonts/`；离线配置不再重复声明字体，避免 Windows 上同一目标写入失败。
- 应用首次启动时 `apps/desktop/electron/document-fonts.ts` 的 `registerWindowsDocumentFonts()` 把字体复制到 `%LOCALAPPDATA%\Microsoft\Windows\Fonts` 并写入 `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`，只影响当前用户、不需要管理员权限；失败只记日志，不阻塞启动。
- 结果：论文、任务书和中期检查表在纯净电脑上不再报 `REQUIRED_FONT_MISSING`，Word/WPS 打开导出的 DOCX 也能看到正确字形。

### 2. 应用内消息中心与远程公告

- 新增消息通知弹窗与侧边栏入口：维护提醒、版本公告按时间窗与版本区间显示，未读数量显示在侧边栏，读完自动记录到本机。
- 消息随更新清单下发（schema 3.0 的 `control.notices`），不新增查询接口；旧清单地址继续提供 schema 2.0，0.1.13 起的旧客户端不受影响。
- 客户端先读 `update_manifest_url_v2`，失败自动回退旧清单。
- 消息按钮支持外链（HTTPS 白名单）与应用内跳转（`guide`/`faq`/`release-notes`/`settings`）。

### 3. 帮助中心与演示资料

- 侧边栏「帮助支持」与 `Ctrl + /` 打开：常见问题（5 类 11 篇）、快捷键、更新说明三个页签，支持搜索；「论文题目」旁可直接查看填写说明。
- 帮助页可一键载入一套虚拟演示资料（任务书、开题报告、中期检查，标题以「参考样例·」开头），随时清除，不影响用户自己的文档。
- 首次使用提供分步引导（遮罩 + 高亮 + 必须点击目标才前进），`Esc` 跳过；帮助中心可重新播放。

### 4. 应用内反馈与联系方式校验

- 新增「反馈问题」弹窗：必填邮箱或手机号，格式错误时提交按钮禁用并给出提示；可选附加诊断包（包含日志、环境与当次文档内容，仅在勾选时上传）。
- 云端新增 `POST /v1/feedback` 端点，写入 `public.feedback_reports` 表（180 天保留、每日清理、仅服务端角色可读写），返回回执编号。
- 反馈与遥测使用独立表，联系方式不会进入匿名统计。

### 5. 崩溃兜底与错误提示

- 渲染进程崩溃时显示错误页，可复制诊断信息、打开安全模式；安全模式会关闭引导与自动弹窗，编辑、预览与导出不受影响。
- 修复 Electron `contextBridge` 丢弃错误自定义属性的问题：错误码与 `details` 随消息结构化传递，界面只显示可读原因，遥测拿到真实错误码。
- 底部错误条 15 秒后自动收起，也可点 × 立即关闭；复制诊断编号改走主进程剪贴板桥，不再受权限拦截。

### 6. 下载完成后一键安装并重启

- 更新弹窗在「已下载」状态提供「安装并重启」，普通更新与必需更新（阻塞弹窗）两个入口一致，都需要用户在确认框里再点一次「保存并安装」。
- 确认后应用先保存当前文档，退出后由一段等待进程退出的脚本静默运行安装包（沿用当前安装目录，NSIS `/D=` 必须是最后一个参数且不带引号），完成后自动重启。
- 安装失败或应用没来得及退出时，下次启动会说明原因；旧版本保持可用。

### 7. 文献校验前后端一致

- 文献字段只有空值（如 `pages = {}`）时，编辑器当场报错并指出字段名，不再出现「检查通过、导出失败」。
- 后端把 UTF-8 BOM 当作空白，与前端一致；失败提示改为「第 N 条参考文献的 X 字段是空值」。
- 修正 GB/T 7714 页码分隔符：会议录析出、专著、析出文献与手册的页码改用冒号，与 LaTeX 输出一致。
- 新增共享夹具与 golden 用例：15 个语法判定用例 + 6 条按仓库 `gbt7714-numerical.bst` 实际渲染结果生成的比对用例。

### 8. 编译失败给出具体原因

- 非论文文档的编译超时从 90 秒放宽到 180 秒。
- 编译失败按缺失宏包、字体、权限、磁盘空间、中文路径、内容过多等原因给出中文说明。

### 9. 关于 / 隐私 / 许可

- 「关于」弹窗展示版本、Electron 与平台信息、数据与隐私说明、GPL-3.0 许可声明。
- `LICENSE`、`NOTICE` 与 `third-party-licenses/`（含自动生成的 npm 依赖清单）随安装包提供；字体再分发按维护者 2026-11-26 的决定记录在 `NOTICE` 中。

### 10. 中文安装目录纳入打包验收

- `Package acceptance` 在 Windows 上把安装包静默装到含中文与空格的目录（`中文 安装 目录\SZTU 文档工作台`），再从该目录跑整套七类文档验证。
- 安装器仍把 TeX 引擎固定在 `C:\ProgramData\SZTU-Docs\engine\<id>`，与用户选择的安装目录无关。

## 云端部署（2026-11-26）

- 云函数 `sztu-telemetry-ingest` 已更新代码：新增 `POST /v1/feedback`、`validateFeedback` 与 `feedback_reports` 写入；原有 `/v1/reports`、`/v1/full-reports`、`/v1/events` 保持兼容。
- 新增 HTTP 访问路由 `/api/diagnostics/v1/feedback`（WEB_SCF → `sztu-telemetry-ingest`，路径透传）。
- 数据库迁移：`public.feedback_reports` 表已创建（11 列、RLS 开启、仅 `service_role` 可 INSERT/SELECT/DELETE、`expires_at` 索引），`cron.schedule('sztu-feedback-retention-daily', '40 3 * * *', ...)` 每日清理过期反馈。
- 生产配置 `config/remote-services.production.json` 新增 `update_manifest_url_v2`，0.2.0 安装包已内置该地址。
- 端点联调：无效反馈返回 `422 INVALID_FEEDBACK_MESSAGE`；有效反馈返回 `202 {ok:true, receipt_id, retention_days:180}` 并成功落库；联调记录已删除。

## 兼容性

- 0.1.13–0.1.19 可以直接应用内更新到 0.2.0；0.1.13–0.1.15 的下载超时缺陷仍存在，建议从下载页手动安装。
- 0.2.0 之前的版本不显示结构化更新说明；这一版起客户端才读取 schema 3.0 清单。
- 安装包体积因内置字体增加约 65 MB（压缩后小于该值）。

## 验证

| 项目 | 结果 |
| --- | --- |
| 后端单元测试 | 310 tests OK（skipped 2），99.484 s |
| 桌面测试 | 75 文件 / 715 测试通过；另有 3 文件 / 14 测试通过 |
| 类型检查 | `tsc -b` 与 `tsc -p tsconfig.electron.json` 均通过 |
| 代码检查 | 0 error / 42 warning（均为既有 React Compiler 建议） |
| 打包预检 | `Packaging Plan OK`：23 个目标文件、11 个字体、模板固定提交 `1c9b692` |
| 打包验收 | `verify_windows_app_bundle.py` → `status: pass`，完整性、UTF-8、环境 20 项全 pass |
| 模板资源 | `verify_thesis_template_resource.mjs` → pass（2026.1.1，sha256 `a49a44f0…`） |
| 安装包实测 | 449,028,286 B；`win-unpacked` 426,581,584 B（字体 61.3 MB、sidecar 23.3 MB、Electron 顶层 317.5 MB） |
| 反馈端点 | 422 校验与 202 落库均通过公网联调 |

## 尚未完成 / 已知限制

- macOS 包本次不构建：Windows 稳定后再排期。
- 安装包未做 Authenticode 签名，首次运行会触发 SmartScreen「仍要运行」提示。
- 验收脚本校验环境与引擎，但不会实际导出七类文档；发布前仍建议在目标电脑上走一遍「新建任务书 → 插图 → 预览 → 导出 PDF/DOCX → Word 打开」。
- 开发版启动时曾出现 `ByteString ... 65533` 报错（`new Headers`），未定位；不影响打包版本功能，继续观察。
- 最低支持版本暂不设置，0.1.13–0.1.19 均可继续使用并通过应用内更新升级。
