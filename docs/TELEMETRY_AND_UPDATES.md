# 匿名遥测与更新通道

## 边界

正式构建使用强制但明确披露的匿名运行遥测。首次启动在任何上传前展示说明；用户可以同意并继续，或退出应用。应用不提供一个实际上会破坏发布策略的“关闭遥测”开关。

允许上传：

- 应用版本、`darwin`/`win32`/`linux`、`arm64`/`x64`；
- 启动、30 分钟心跳和粗粒度运行时长分桶；
- 学生档案/开题报告/任务书/中期检查/检查与导出页面的访问计数；
- 内容检查、分页预览、模板同步、导出、人工验收的成功/失败/取消；
- 稳定且无内容的错误码；
- 更新检查、发现版本和完整性校验后的下载结果。

禁止上传：姓名、学号、学院、专业、班级、指导教师、论文题目、正文、目录、参考文献、文件名、绝对路径、模板内容、导出哈希、自由文本错误、剪贴板、硬件序列号、账号标识和原始日志。

安装标识是随机 UUID，每 30 天轮换。事件队列位于 Electron `userData/telemetry`，权限为 `0700/0600`，最多保留 1000 条；网络失败不阻塞编辑、检查或导出。

## 部署拓扑

- 腾讯 COS：公开只读的签名更新清单和安装包；使用自定义域名和 HTTPS。
- 轻量服务器或云函数：接收遥测 `POST`。服务端必须再次校验 `contracts/telemetry-batch.schema.json`，限制请求体和频率，关闭或缩短接入层原始 IP 日志，按发布前隐私说明执行删除期限。
- 客户端不包含 COS SecretId/SecretKey。遥测端点的公开项目标识不能被当作鉴权秘密；服务端依赖 Schema、速率限制、异常检测和批次 UUID 去重。

## 发布配置

开发环境可以使用以下变量；只允许 HTTPS，回环地址可使用 HTTP：

```text
SZTU_TELEMETRY_ENDPOINT=https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events
SZTU_UPDATE_MANIFEST_URL=https://downloads.example.com/stable/manifest.json
SZTU_UPDATE_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----
```

正式安装包在 `process.resourcesPath/remote-services.json` 放置：

```json
{
  "telemetry_endpoint": "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events",
  "update_manifest_url": "https://downloads.example.com/stable/manifest.json",
  "update_public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

Ed25519 私钥只存在于隔离的发布环境。客户端只固定公钥。清单签名对象是 `payload` 的递归键排序紧凑 JSON；随后用 Base64 编码 64 字节签名。

当前开发构建默认连接上述 CloudBase 遥测端点；`SZTU_TELEMETRY_ENDPOINT` 仍可用于本地回环测试。服务端 API Key 只存在于云函数环境变量中，不进入客户端仓库。

## 查看遥测数据

仓库提供独立的本机开发者看板，见 `apps/telemetry-admin/README.md`。先使用账号完成 `tcb login`，随后运行：

```bash
corepack pnpm telemetry:dev
```

看板通过本机服务端调用 CloudBase CLI 的固定只读 SQL，并只向浏览器返回聚合指标和白名单清洗后的事件摘要。项目目录和浏览器构建均不保存 `service_role` API Key。

## 生成签名更新清单

发布环境准备 Ed25519 私钥和对应公钥后，可以从仓库根目录生成签名清单：

```bash
corepack pnpm update:manifest -- \
  --version 0.2.0 \
  --private-key /secure/release-ed25519-private.pem \
  --output /secure/release/manifest.json \
  --artifact darwin-arm64=/secure/release/SZTU-Docs-0.2.0-arm64.dmg=https://downloads.example.com/stable/SZTU-Docs-0.2.0-arm64.dmg
```

工具会读取安装包的实际字节数和 SHA-256，按客户端相同的规范化规则签名 `payload`，并以 `0600` 权限写出清单。私钥和产物路径必须位于仓库之外。生成清单不等于完成发布：仍需安装包代码签名、COS 上传、客户端下载与 Word/WPS 回归验收。

开发构建可以在未配置远程服务时确认并继续，此时不会产生外部请求。正式构建若缺少遥测接收端、更新清单 URL 或公钥，会停在首次说明页并只允许退出，避免发布出一个名义上强制、实际上没有数据通道或安全更新源的版本。

## 当前能力边界

应用会在启动时及每 30 分钟轮询版本；签名、平台、架构、大小和 SHA-256 全部通过后才把安装包保存到私有更新目录。当前尚未建立安装包、macOS/Windows 代码签名、自动替换、重启回滚和跨平台验收，因此“下载完成”不能表述为“更新已安装”。
