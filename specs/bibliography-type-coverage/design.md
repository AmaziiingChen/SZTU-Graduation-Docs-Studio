# 参考文献类型覆盖设计

## 架构边界

- `apps/desktop/src/lib/bibtex.ts` 继续负责本地解析、类型映射和只读格式化结果。
- `backend/src/sztu_docs_backend/bibtex_gate.py` 只复核源结构、类型和必填字段，不参与格式化。
- 模板继续接收已经生成的结构化段落；本次不把原始 BibTeX 传给 Word 或 LaTeX 渲染器。

## 类型与载体映射

| BibTeX 类型 | 载体标识 | 处理 |
| --- | --- | --- |
| `book`, `manual` | `[M]` | 整体书籍或手册 |
| `inbook`, `incollection` | `[M]//` | 书籍析出文献 |
| `proceedings` | `[C]` | 会议录 |
| `inproceedings`, `conference` | `[C]//` | 会议析出文献 |
| `standard` | `[S]` | 标准 |
| `online`, `electronic`, `www` | `[EB/OL]` | 网络资源 |
| `misc` | `[EB/OL]` 或 `[Z]` | 有 URL 才视为网络资源 |

书籍补充渲染 `edition`、`translator` 和 `pages`。URL 和访问日期继续由统一标识符尾部
处理。既有类型映射保持不变。

## 兼容与安全

- 不提高既有 `@book` 的必填门槛，以免已有草稿突然失效；缺少出版项属于后续可增加的
  非阻断质量提示。
- 前后端共享相同的类型集合；后端只返回稳定错误码，不回显原始来源。
- 不根据题名猜测文献类型，避免把普通 `@misc` 自动误判为网页。

## 测试

- 前端单元测试覆盖书籍完整字段、书籍章节、会议论文、会议录、标准、网页和普通 `misc`。
- 后端单元测试覆盖新增类型计数与必填字段门禁。
- 运行参考文献相关前端测试、完整后端测试以及桌面生产构建。
