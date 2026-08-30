# Contracts

本目录包含 Electron、Python sidecar、模板包与测试工具共同使用的、与传输实现无关的
JSON 合同。所有 JSON 字段统一使用 `snake_case`；所有 Schema 使用 JSON Schema
Draft 2020-12，并以稳定 `$id` 作为跨语言标识。

## 合同清单

| 文件 | 版本字段 | 用途 |
| --- | --- | --- |
| `ipc-envelope.schema.json` | `protocol=1.0` | JSONL 请求与响应信封 |
| `student-profile.schema.json` | `schema_version=1.0` | 学生档案 |
| `document-draft.schema.json` | `schema_version=1.0` | 允许不完整的开题报告草稿 |
| `proposal.schema.json` | `schema_version=0.2` | 严格、可导出的开题报告数据 |
| `content-block.schema.json` | 独立 `$defs` | 过程文档共用富文本、列表和图片内容块 |
| `midterm.schema.json` | `schema_version=0.1` | 严格、可导出的中期检查表数据 |
| `environment-check-result.schema.json` | IPC 协议版本承载 | 本地环境状态 |
| `check-result.schema.json` | `schema_version=1.0` | 独立质量门禁结果 |
| `export-request.schema.json` | `schema_version=1.0` | 已通过严格文档 Schema 的导出请求 |
| `export-receipt.schema.json` | `schema_version=1.0` | 输出文件、哈希及质量门禁回执 |
| `export-operations.schema.json` | `$defs` fragments | 预检、运行、取消、历史和产物打开 |
| `template-manifest.schema.json` | `manifest_version=1.0` | 模板包清单 |
| `qa-policy.schema.json` | `policy_version=1.0` | 模板包质量策略 |
| `template-install-operation.schema.json` | `$defs.params/result` | 离线模板包安装 |
| `qa-record-operation.schema.json` | `$defs.params/result` | Word/WPS 目标编辑器 QA 记录 |

具体升级规则见 [`COMPATIBILITY.md`](COMPATIBILITY.md)。每个文件的稳定 `$id` 可直接从
Schema 根对象读取。

`export-operations`、`template-install-operation` 和 `qa-record-operation` 按方法分别验证
命名的 `$defs` fragment，不提供允许调用者任选方法名或任意 params 的通用命令入口。
Python 静态类型镜像位于 `python_contract_types.py`；它不能替代运行时 Schema、路径和哈希
验证。

## 草稿与导出边界

`document-draft` 明确允许字段尚未填写、段落数组为空，用于自动保存。通过草稿 Schema
只说明数据可持久化，**不表示可导出**。`export-request.document` 直接引用严格的
`proposal.schema.json`；中期检查工作台在导出前构造并验证严格的
`midterm.schema.json`。缺失学生信息或正文的草稿不能误入正式导出。

## JSONL transport

Sidecar 从标准输入逐行读取 UTF-8 JSON 请求，并为每个非空输入行向标准输出写一个紧凑
JSON 响应。stdout 仅用于协议；诊断和 traceback 写 stderr。协议版本为 `1.0`。

## Imported proposal contract

`proposal.schema.json` 是模板仓库中当前开题报告合同的逐字节导入：

- 导入时源路径：`templates/proposal/schema/proposal.schema.json`
- 源 SHA-256：
  `914a9117723c7448635993edc81e9fab7e79d8d4cce0544b50527be60fe9530e`
- 导入日期：`2026-08-30`

该源仓库仅是开发期 provenance，不是运行时依赖。更新必须显式重新导入、记录新摘要并
审查 Schema diff。这里不导入官方 DOCX、商业字体、生成文档或私人学生材料。

`midterm.schema.json` 与 `content-block.schema.json` 导入自同一模板工作树快照。为使
应用合同目录可独立解析，仅把中期合同中指向 `templates/common` 的相对 `$ref` 改为同目录
`content-block.schema.json`；字段、约束和语义未改动。源 SHA-256 分别为
`17924cfa9daf2e1a56e29ab883bbe5fd93482c2a3afa88591f0ad3a355707d58` 和
`6c766db71640843a8eaa86d9398e6a02b3b9b0d11edfd24b512e27c8caef0562`，导入日期为
`2026-08-30`。来源仍是未提交工作树快照，不代表已发布模板包。
