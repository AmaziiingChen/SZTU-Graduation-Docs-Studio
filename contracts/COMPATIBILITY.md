# 合同兼容与迁移规则

## 版本模型

应用合同使用 `MAJOR.MINOR`，模板包自身使用 SemVer `MAJOR.MINOR.PATCH`。

- Patch：只修正文档、示例或不会改变任何合法/非法实例集合的描述；无需迁移。
- Minor：只允许向后兼容变化，例如增加非必需字段、增加独立的新 Schema。旧读取器可以
  忽略它不了解的合同版本，但不能把未知字段静默写回。
- Major：任何收紧约束、删除或重命名字段、改变语义、增加必需字段均属于破坏性升级。

文档业务 Schema（当前 `proposal 0.2`、`midterm 0.1` 与 `task_book 0.1`）独立版本化。模板包必须同时声明
`app_contract` 与 `document_schema`，不能根据模板包版本猜测合同版本。

## 读取与写入

1. 读取器只接受自己明确列出的 major；当前支持应用合同 `1.x`、开题报告合同 `0.2` 和中期检查合同 `0.1`。
2. 同 major 下，读取器可接受不高于自身已知 minor 的合同。更高 minor 返回
   `CONTRACT_VERSION_TOO_NEW`，不得降级后继续写入。
3. 未知 major 返回 `CONTRACT_VERSION_UNSUPPORTED`。
4. 未知字段由 Schema 的 `additionalProperties: false` 拒绝，防止拼写错误和跨版本数据
   在持久化时静默丢失。
5. 写入始终使用当前版本；不得就地覆盖尚未成功迁移的原数据。

## 迁移失败

迁移必须“读取旧值 → 在内存中转换 → 用目标 Schema 验证 → 原子写入新值”。任一步失败：

- 保留原始数据和版本；
- 返回稳定错误码 `CONTRACT_MIGRATION_FAILED` 和可操作的中文说明；
- 详细异常只进入脱敏开发日志；
- 不把部分转换的数据标为当前版本，也不进入导出。

草稿合同与正式文档合同不互相替代。草稿通过 `document-draft` 后，导出前仍须构造并验证
严格的对应文档实例，再构造导出请求。

## 结构化列表兼容

公共正文合同继续接受既有的 `ordered_list`：旧数据中的条目只包含可选 `marker` 与
`content` 时无需迁移。新写入器可使用 `unordered_list`，并通过条目的可选 `children`
建立最多四级的列表树；树的父子关系是层级权威，不从空格、Tab 或编号文本反推层级。
`unordered_list` 不接受 `marker`。不理解这些新字段或类型的旧写入器不得回写新格式草稿。

## 富文本字段与参考文献草稿

`document-draft 1.0` 当前仍处于未发布开发阶段。目录条目和任务书进度条目允许缺失字段，
但已填写的目录 `title`、进度 `content` 只接受字符串或公共富文本段落；未知字段和任意对象
不再作为可持久化草稿。发布后若再次收紧同类约束，必须按上文规则升级 major，而不能沿用
同一合同版本。

旧草稿中的字符串标题、目录标题、进度内容和已格式化参考文献无需立即重写；读取器可在内存
中迁移并在成功验证后原子写回。BibTeX 源只允许保存在草稿的
`editor_state.bibliography`，不得进入严格文档、渲染器或导出输入快照。解析失败时保留原始
草稿和上一份有效结构化参考文献，并阻止检查、预览和导出。完整决策见
[`0012-rich-field-modes-and-bibtex-references.md`](../docs/decisions/0012-rich-field-modes-and-bibtex-references.md)。
