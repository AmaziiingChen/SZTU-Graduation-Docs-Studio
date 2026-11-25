# 中期检查结构化插图设计

## 数据模型

沿用 `image` 内容块并增加可选字段：

- `id`: 稳定图 ID，新建图片必填，旧内容允许缺省。
- `chapter`: 正整数章号，默认 1。
- `source_citation_key`: 可选 BibTeX 键。
- `caption`: 只保存题注正文，不保存 `图 X-Y` 前缀。

正文中的交叉引用保存为文本令牌 `{{fig:<id>}}`。编辑器以不可直接改写的行内节点显示当前图号；Word/LaTeX 在渲染前按图片顺序解析令牌。该方案保持现有段落 run 契约兼容，不引入第二套富文本格式。

## 本机资源边界

Electron 主进程负责选择、校验并复制图片到 `userData/document-assets`。资源名使用内容 SHA-256，渲染进程只接收受管绝对路径和受限的 `sztu-asset:` 预览 URL，不直接读取任意文件。

## 编辑器

TipTap 增加两个语义节点：块级 `figureBlock` 与行内 `figureReference`。编号插件扫描文档，按章维护计数器并同步显示标签。工具栏只组合现有默认 shadcn/ui：插入/编辑图片使用 `Dialog`，引用列表使用 `DropdownMenu`。

## 导出

- Word：图片段落 `keep_with_next = true`，题注段落 `keep_together = true`。
- LaTeX：图片和题注放入不可分页的 `minipage`；过高图片由最大高度限制在正文区域内。
- 两端共用稳定编号算法和未知引用的失败策略。

## 兼容与迁移

旧 `image` 块在规范化时生成仅用于当前渲染的确定性 ID，并采用第 1 章。保存过编辑器后会补齐稳定 ID 与章号。
