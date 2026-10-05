# 匿名遥测与更新通道

## 边界

正式构建使用强制但明确披露的匿名运行遥测。首次启动在任何上传前展示说明；用户可以同意并继续，或退出应用。应用不提供一个实际上会破坏发布策略的“关闭遥测”开关。

允许上传：

- 应用版本、`darwin`/`win32`/`linux`、`arm64`/`x64`；
- 启动、30 分钟心跳和粗粒度运行时长分桶；
- 学生档案/开题报告/任务书/中期检查/检查与导出页面的访问计数；
- 内容检查、分页预览、模板同步、导出、人工验收的成功/失败/取消；
- 每份本地过程文档第一次成功导出的匿名完成事件，用于展示全体累计生成份数；
- 稳定且无内容的错误码；
- 更新检查、发现版本和完整性校验后的下载结果。

禁止上传：姓名、学号、学院、专业、班级、指导教师、论文题目、正文、目录、参考文献、文件名、绝对路径、模板内容、导出哈希、自由文本错误、剪贴板、硬件序列号、账号标识和原始日志。

安装标识是随机 UUID，每 30 天轮换。事件队列位于 Electron `userData/telemetry`，权限为 `0700/0600`，最多保留 1000 条；网络失败不阻塞编辑、检查或导出。

客户端仅在本机保存已经计数的文档 ID，用于避免同一份文档重复导出时反复累计；文档 ID 不进入上传事件。服务端只公开返回聚合后的累计数字，不返回单次事件或安装标识。重装应用或清除本机数据后，本地去重记录会丢失，因此该数字是匿名使用量指标，不是可审计的业务凭证。

## 本地故障诊断包

“高级信息与故障诊断”提供用户主动创建的本地诊断包。它与持续匿名遥测相互隔离，不读取遥测队列，也不会自动上传。主进程最多保存 200 条结构化操作记录，只包含固定操作名、成功/失败/取消、耗时区间和稳定错误码；不保存自由文本日志。

创建诊断包时，主进程重新检查文档环境，并只保留已知组件的 `id`、是否必需和通过/警告/失败状态。Python 环境返回的说明、扩展字段和路径在报告构造前即被丢弃。报告另包含应用/Electron 版本、操作系统版本、平台/架构，以及 CPU 数量和内存容量的区间值；不包含 CPU 型号、主机名、用户名、网络标识或硬件序列号。

写盘前必须执行最终隐私扫描，拒绝敏感键、用户目录路径、凭据形态或超出 256 KiB 的报告。诊断目录和 JSON 文件使用 `0700/0600` 权限，操作记录最多保留 200 条。准备好的报告在内存中十分钟后失效，用户只能通过系统保存对话框写入自行选择的位置。

远程“发送诊断包”只在用户主动操作后执行。接收端重新执行严格 Schema 与隐私扫描，限制请求大小和频率；诊断报告仅允许服务端角色访问，保存 30 天后由 PostgreSQL 每日清理任务物理删除，接收和删除动作写入独立审计表。不得把诊断包改为原始日志上传，也不得在客户端放入服务端凭据。

## 部署拓扑

- 腾讯 COS：公开只读的签名更新清单和安装包；使用自定义域名和 HTTPS。
- 同一公开只读存储位置可放置独立的中期检查日期规则文件 `releases/stable/midterm-date-policy.json`；客户端只下载签名规则，不上传学生学院或所选日期。
- 轻量服务器或云函数：接收遥测 `POST`。服务端必须再次校验 `contracts/telemetry-batch.schema.json`，限制请求体和频率，关闭或缩短接入层原始 IP 日志，按发布前隐私说明执行删除期限。
- 同一遥测路由的只读 `GET ?aggregate=completed_documents` 仅返回匿名累计生成份数，不暴露原始事件或安装标识。
- 客户端不包含 COS SecretId/SecretKey。遥测端点的公开项目标识不能被当作鉴权秘密；服务端依赖 Schema、速率限制、异常检测和批次 UUID 去重。

## 发布配置

开发环境可以使用以下变量；只允许 HTTPS，回环地址可使用 HTTP：

```text
SZTU_TELEMETRY_ENDPOINT=https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events
SZTU_DIAGNOSTIC_ENDPOINT=https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/diagnostics/v1/reports
SZTU_UPDATE_MANIFEST_URL=https://downloads.example.com/stable/manifest.json
SZTU_UPDATE_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----
SZTU_MIDTERM_DATE_POLICY_URL=https://downloads.example.com/stable/midterm-date-policy.json
```

正式安装包在 `process.resourcesPath/remote-services.json` 放置：

```json
{
  "telemetry_endpoint": "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events",
  "diagnostic_endpoint": "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/diagnostics/v1/reports",
  "update_manifest_url": "https://downloads.example.com/stable/manifest.json",
  "midterm_date_policy_url": "https://downloads.example.com/stable/midterm-date-policy.json",
  "update_public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

本项目当前生产信任锚保存在 `config/remote-services.production.json`。它只包含公开端点和 Ed25519 公钥，不包含任何凭据；打包流程必须把它复制为安装包资源目录中的 `remote-services.json`。更换签名私钥后，已经安装的旧客户端不会自动信任新公钥，因此私钥轮换必须作为独立的客户端版本迁移处理。

## 中期检查日期规则

在本机“版本发布”管理页的“中期检查日期规则”中，为需要限制的学院填写档案中的**学院全称**、开始日期和结束日期。日期边界都可选；未列出的学院不受范围限制。“生成签名日期规则”只写出 `~/.sztu-docs-release/midterm-date-policy.json`，不会改变学生端。“发布日期规则到云端”会重新签名当前表单内容，并通过本机已登录的 CloudBase CLI 上传到正式配置中的 `midterm_date_policy_url`，上传后校验并检查云端文件列表。撤销所有限制时应发布包含空规则数组的新签名文件，不能只删除云端文件。

规则与更新清单分离，避免旧版客户端因新字段拒绝更新清单。新版客户端每 30 分钟拉取一次规则，并缓存已经通过 Ed25519 签名验证的文件；离线时沿用缓存。若新安装设备尚未取得规则且网络不可用，就无法获知学院限制，需在联网后再用于有日期限制的学院。已填但后来超出范围的日期会显示为无效，预览和导出不会继续；学生端不显示额外说明文案。所有学院匹配都在本机完成。

Ed25519 私钥只存在于隔离的发布环境。客户端只固定公钥。清单签名对象是 `payload` 的递归键排序紧凑 JSON；随后用 Base64 编码 64 字节签名。

当前开发构建默认连接上述 CloudBase 遥测端点；`SZTU_TELEMETRY_ENDPOINT` 仍可用于本地回环测试。服务端 API Key 只存在于云函数环境变量中，不进入客户端仓库。

## 查看遥测数据

仓库提供独立的本机开发者看板，见 `apps/telemetry-admin/README.md`。先使用账号完成 `tcb login`，随后运行：

```bash
corepack pnpm telemetry:dev
```

看板通过本机服务端调用 CloudBase CLI 的固定只读 SQL，并只向浏览器返回聚合指标和白名单清洗后的事件摘要。项目目录和浏览器构建均不保存 `service_role` API Key。

## 生成签名更新清单

Ed25519 是免费、自持有的发布签名，不需要购买 Apple Developer 或 Windows
代码签名证书。它用于证明更新清单、公告和远程策略确实由项目维护者发布；不能替代
macOS 公证或 Windows Authenticode 的系统安装信任。

第一次发布时，在仓库外的安全目录生成密钥：

```bash
corepack pnpm update:keygen -- --output-directory /安全位置/sztu-docs-release
```

私钥只保留在发布电脑的安全目录并另做加密备份。`update-public.pem` 可以写入正式
安装包的 `remote-services.json`；`update-private.pem` 不得进入仓库、客户端、网页、
COS 或聊天记录。工具拒绝覆盖已有密钥，避免误操作改变信任根。

准备安装包和 `config/release-control.example.json` 的副本后生成签名清单：

```bash
corepack pnpm update:manifest -- \
  --version 0.2.0 \
  --private-key /安全位置/sztu-docs-release/update-private.pem \
  --control /安全位置/sztu-docs-release/release-control.json \
  --output /安全位置/sztu-docs-release/manifest.json \
  --artifact 'darwin|arm64|/安全位置/SZTU-Docs-0.2.0-arm64.dmg|https://下载域名/stable/SZTU-Docs-0.2.0-arm64.dmg' \
  --artifact 'win32|x64|/安全位置/SZTU-Docs-0.2.0-x64.exe|https://下载域名/stable/SZTU-Docs-0.2.0-x64.exe'
```

工具会读取安装包的实际字节数和 SHA-256，按客户端相同的规范化规则签名 `payload`，并以 `0600` 权限写出清单。私钥和产物路径必须位于仓库之外。生成清单不等于完成发布：仍需安装包代码签名、COS 上传、客户端下载与 Word/WPS 回归验收。

如果只发布公告、使用说明或服务状态，可保留 `--control` 并省略全部 `--artifact`；一旦提高版本并要求客户端下载更新，则必须提供对应平台的真实安装包。

### 签名远程策略

清单 2.0 在原更新信息之外支持以下经过签名的字段：

- `update_policy`：`optional`、`recommended` 或 `required`；
- `minimum_supported_version`：低于该版本时必须更新，或设为 `null`；
- `service_status`：`normal`、`maintenance` 或 `retired`；
- `help_url`：动态使用说明入口，只接受 HTTPS，或设为 `null`；
- `announcement`：带唯一 ID、标题、正文、级别、生效时间、失效时间和能否关闭的纯文本公告。

客户端拒绝未知字段、HTML、Markdown、无效版本、非 HTTPS 链接、错误时间范围和无效
签名。`maintenance` 会提示维护但保留本地资料访问；`retired`、低于最低版本或不可关闭
公告会阻止进入工作台。无网络时不会把未验证的远程内容当作指令执行。

旧版 1.0 清单继续兼容，其行为等同于可选更新且没有公告或停用策略。

开发构建可以在未配置远程服务时确认并继续，此时不会产生外部请求。正式构建若缺少遥测接收端、更新清单 URL 或公钥，会停在首次说明页并只允许退出，避免发布出一个名义上强制、实际上没有数据通道或安全更新源的版本。

## 当前能力边界

应用会在启动时及每 30 分钟轮询版本。发现适配本机平台和架构的新版本后，先提示版本号与下载大小，只有用户点击“下载更新”才请求安装包；选择“稍后处理”后可从侧栏“新版本可用”重新打开。下载过程中避免重复请求与轮询干扰，失败可重试。签名、平台、架构、大小和 SHA-256 全部通过后才把安装包保存到私有更新目录，并提供“显示更新文件”供用户手动安装。公告、版本策略和服务状态也必须通过同一个 Ed25519 签名后才会显示或执行。当前尚未完成受系统信任的 macOS/Windows 发布签名、自动替换、重启回滚和跨平台安装验收，因此“下载完成”不能表述为“更新已安装”。

## 群聊首次分发与后续更新

首次安装包可以通过微信群或其他平台分发。安装后的更新通道由包内 `remote-services.json` 的地址和公钥决定，与最初从哪里取得安装包无关。应用运行并联网、完成首次告知后才能检查；应用关闭时没有系统级实时推送。

每次模板修复也按应用发布处理：提高应用版本号，将修复后的模板引擎和字体资源重新装入安装包，分别验证 Windows/macOS 输出。普通用户下一次预览或导出会读取新版本内置模板；手动关联的本地模板工程具有更高优先级，应单独确认。已经导出的 Word/PDF 不会自动改写，需要重新生成。

发布顺序为：先上传版本化安装包，验证公开下载地址；再用原 Ed25519 私钥生成含真实文件大小、SHA-256 与平台架构的清单；验证签名与客户端下载后，最后替换 stable 清单。Windows 使用 `win32/x64`，当前 macOS 构建使用 `darwin/arm64`。清单没有对应平台安装包时，该平台不能完成更新，不能用 macOS 安装包替代 Windows。

已有客户端固定信任原公钥。迁移发布电脑时应安全迁移原私钥，不要重新生成另一组密钥来给现有用户发布更新。版本发布后台目前负责生成清单；安装包和更新清单上传仍是独立发布步骤。本地开发版默认不启用生产更新地址，可用开发环境变量或合成签名清单测试，不把测试公告或测试安装包发布到生产通道。

## 免费分发与系统安装信任

Ed25519 清单签名免费，可在未购买系统发布证书时保持更新来源与内容校验。它不提供 Windows Authenticode 发布者身份，也不替代 Apple Developer ID 或公证。

Windows 的 NSIS 安装包可按未做 Authenticode 签名的方式分发，可能显示“未知发布者”或 SmartScreen 来源提示；是否能继续取决于系统及组织策略。macOS 当前配置 `identity: "-"` 使用本地 ad-hoc 签名，没有 Developer ID 和公证信任；接收端可能需要按系统“隐私与安全性”提供的方式明确允许打开。免费、非商业用途不使安装包自动获得系统信任。产品不提供关闭 Defender、SmartScreen、Gatekeeper 或移除来源标记的脚本。

安装指引以 Microsoft、Apple 当前文档和目标设备验证为准；本地构建及更新逻辑测试不能替代未签名安装包的首次安装验收。
