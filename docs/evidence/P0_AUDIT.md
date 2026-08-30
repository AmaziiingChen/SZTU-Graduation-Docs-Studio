# P0 保护审计：当前模板仓库

- 审计日期：2026-08-30（Asia/Shanghai）
- 源仓库：本地模板仓库（工作区绝对路径已脱敏）
- 审计方式：只读；未修改、提交、推送、删除或运行回归
- 证据边界：本报告记录本机 Git 引用与文件状态；未执行 `git fetch`，因此不把远端最新状态视为已验证

## 结论

当前模板仓库尚未达到可以安全清理或批量提交的状态。开题报告原型、官方资料迁移、治理文档和忽略规则都还位于未提交工作区；其中模板原型没有可定位的 Git 提交。开始应用开发可以在独立仓库进行，但在源仓库完成保护前，禁止批量暂存、清理或重写当前工作区。

最紧急的风险是：`.gitignore` 已新增 `/references/private/*`，而 `texclear.sh` 仍执行 `git clean -X -fd`。只读预演 `git clean -ndX` 明确显示它会删除 `references/private/` 下的私人材料、`output/` 和 `tmp/`。在修正清理策略并建立备份前，禁止运行 `texclear.sh`、`git clean -X` 或 `git clean -x`。

## 1. Git 开发前快照

```text
## feat/project-bootstrap...origin/feat/project-bootstrap
 M .DS_Store
 M .gitignore
 M README.md
 M docs/PROJECT_PLAN.md
 D official_documents/本科生毕业论文（设计）撰写规范及要求.doc
 D official_documents/本科论文格式范例2026.docx
?? AGENTS.md
?? docs/LOCAL_WORKBENCH.md
?? docs/LOCAL_WORKBENCH_DEVELOPMENT_CHECKLIST.md
?? docs/RENDERING_QA.md
?? references/
?? scripts/
?? templates/
```

本机引用：

| 项目 | 已观察值 |
| --- | --- |
| 当前分支 | `feat/project-bootstrap` |
| `HEAD` | `4dccad34af4f6318988201a39a59c6db003cfc10` |
| 跟踪分支 | `origin/feat/project-bootstrap`，与 `HEAD` 相同 |
| `origin` | `https://github.com/AmaziiingChen/SZTU-Thesis-Latex-Template.git` |
| `upstream` | `https://github.com/SZTU-ACM/SZTU-Thesis-Latex-Template.git` |
| 本机 `upstream/master` | `3e51a3db7b0af1469490712b3a6924bbefc574dd` |
| 相对本机上游 | 上游侧 0 个、当前分支侧 1 个提交 |
| 另一个已推送分支 | `fix/cross-platform-fonts`=`1efdba6d0a571d8ed1b7759fa3ea68597a6b93f8` |

`gh auth status` 返回：账号 `AmaziiingChen` 处于 active，但 token 无效。当前不能创建 PR 或 Release，也不能把本机远程引用解释为 GitHub 的最新状态。

## 2. 工作区归属与保护边界

### 已观察

- 已跟踪修改：`.DS_Store`、`.gitignore`、`README.md`、`docs/PROJECT_PLAN.md`。
- 已跟踪删除：`official_documents/` 中两个学校文档。
- 未跟踪成果：`AGENTS.md`、工作台方案与清单、中文渲染规范、`references/`、`scripts/`、完整的 `templates/proposal/`。
- `templates/proposal/` 现含 Schema v0.2、四组 fixture、Word 渲染器、LaTeX 渲染器、回归入口、版式规格、QA 记录、转换后的 DOCX 底稿和官方 Word 导出 PDF。
- `references/official/` 有 22 个非缓存文件，约 30 MB；其公开再分发权未在仓库内得到证明。
- `references/private/` 有 73 个私人样例文件，约 118 MB；忽略规则生效，除 `README.md` 外均不得入库。
- `tmp/` 约 141 MB，`output/` 约 152 KB；它们是本地生成物/真实样例输出，不应作为源代码提交。
- 四组 fixture 使用 `张三`、`202200000001`、`李明` 等示例值，外观上是合成数据；提交前仍应做一次专门的隐私扫描。
- `templates/proposal/fonts.local/` 已忽略，且 README 明确禁止分发 SimSun、SimHei、Times New Roman 商业字体。

### 不能自行确认

- 所有当前修改均按用户已有工作处理；本次只读审计不能替用户确认逐个文件的最终归属。
- 学校通知、DOC/DOCX/PDF、由学校模板转换出的 `official-template.docx` 和 `official-template-word.pdf` 是否允许随开源仓库或 Release 再分发，仍需来源/授权确认。
- `templates/proposal/word/official-template.docx` 的 OOXML 核心属性含 `lastModifiedBy=张晨晨`。这不证明正文含私人内容，但属于发布前应清理或确认的文档元数据。

## 3. 忽略规则与清理风险

### 已正确忽略

- `.DS_Store`
- `~$*.doc`、`~$*.docx`、`~$*.xlsx`、`~$*.pptx`
- `*.py[cod]`、`__pycache__/`
- `/tmp/`
- `/references/private/*`，并保留 `/references/private/README.md`
- `/output/pdf/private/`
- `/templates/proposal/fonts.local/`

### 未完成

- 根目录 `.DS_Store` 已经被 Git 跟踪，新增忽略规则不会自动解除跟踪；在安全提交中需从索引移除，但不要删除用户本地文件。
- `texclear.sh` 的广泛 `git clean -X -fd` 与“将长期保留的私人资料放入 `.gitignore`”互相冲突。
- `git clean -ndX` 的只读结果包括删除 73 个私人资料文件，以及整个 `output/`、`tmp/`。这是可复现的资料丢失风险。

### 必须先执行的修复策略

1. 在任何清理前，为 `references/private/` 建立独立、可恢复的本地备份并核对文件数量/哈希。
2. 将 `texclear.sh` 改为只删除明确列出的 LaTeX 构建产物；禁止让清理范围由整个 `.gitignore` 推导。
3. 加入清理脚本回归：预演/测试不得包含 `references/`、`templates/`、`output/pdf/private/` 或任何学生资料路径。
4. 在治理规则中永久禁止 `git clean -X/-x` 和无范围的 `git add .`。

## 4. `official_documents/` 迁移证据

两个被标记删除的已跟踪文件，在 `references/official/` 根目录存在字节级相同副本：

| 文件 | 旧 Git blob 与新文件 SHA-256 | 大小 |
| --- | --- | --- |
| `本科生毕业论文（设计）撰写规范及要求.doc` | `caa283de4cfc005b68a5728f6758e0d785730b95519f274e6fceaff3a3c0d57b` | 35,840 B |
| `本科论文格式范例2026.docx` | `707a07c312b2a84d0d43ff7bb24756703e730d7a236bcc39dfc507177e31976c` | 197,886 B |

因此，从文件内容看这是精确迁移而不是内容删除；但 Git 目前尚未记录 rename。建议把这两个文件的迁移做成独立提交，并与新增的其余 2026 通知附件分离。只有在再分发边界确认后才提交新增学校附件。

## 5. 现有回归入口与当前证据边界

入口：

```bash
python3 templates/proposal/test.py
python3 templates/proposal/test.py --skip-pdf
python3 scripts/validate_cjk_render.py path/to/main.pdf
```

`templates/proposal/test.py` 会写入 `tmp/proposal-tests/`，对 `short`、`normal`、`long`、`layout_stress` 四组 fixture 生成 DOCX，并在未使用 `--skip-pdf` 时编译四组 LaTeX/PDF。它依赖 `python-docx`、`pdfplumber`、Pillow、XeLaTeX、Poppler 工具和授权字体。当前仓库没有 Python 依赖锁文件或 requirements 文件。

本机已观察到 `xelatex`、`pdfinfo`、`pdffonts`、`pdftocairo` 和 `python3` 命令。此次只读审计没有执行回归，以免产生或覆盖输出。因此：

- 当前源码声明的 Schema 与四组 fixture 都是 `0.2`；
- `templates/proposal/QA.md` 记录的是 2026-08-29 历史结果，不能当作本次重新验证；
- 本次未重新证明内容提取、中文字形、逐页版式或目标编辑器状态；
- v0.2 历史记录仅称 Microsoft Word 验证了正常样例；短、长、压力样例的 Word/WPS 目标编辑器验收仍未完成。

回归执行前，应先修复清理风险、固定依赖并确认输出目录不会覆盖私人资料。

## 6. 建议的原子提交切片

禁止使用 `git add .`。每片都应先 `git diff --cached --name-status` 和 `git diff --cached --check`，确认只包含下列范围。

1. **安全与忽略规则**：修正 `.gitignore`、将根 `.DS_Store` 从索引解除跟踪、把 `texclear.sh` 改成白名单式清理，并添加不触及私人目录的测试。此片优先级最高。
2. **参考目录迁移**：仅做两个字节相同文件从 `official_documents/` 到 `references/official/` 的 rename，并同步相应 README 链接；不混入其余学校附件。
3. **开题数据合同**：`templates/proposal/schema/`、`fixtures/`、`spec/` 和对应 README。提交前完成 fixture 隐私扫描。
4. **Word 渲染器**：`templates/proposal/word/render.py` 及其测试；`official-template.docx` 作为条件性二进制资产单独审查元数据与分发权，不能默认随代码提交。
5. **LaTeX 渲染器**：`templates/proposal/latex/`；不提交 `fonts.local/` 或商业字体。
6. **质量门禁**：`templates/proposal/test.py`、`scripts/validate_cjk_render.py`、`docs/RENDERING_QA.md`、`templates/proposal/QA.md`。运行四组回归后，把新证据作为独立验收记录，不改写历史结果。
7. **项目与工作台文档**：`AGENTS.md`、`docs/LOCAL_WORKBENCH*.md`、`README.md`、`docs/PROJECT_PLAN.md`。与模板功能代码分离，避免上游 PR 混题。
8. **其他官方附件**：只有逐项完成来源、哈希、可再分发性和隐私检查后，才决定公开提交、仅本地保存或改成用户本地导入；不要与前述提交合并。

## 7. P0 任务可勾选性

| 任务 | 状态 | 依据/阻塞 |
| --- | --- | --- |
| `P0-001` | 可勾选 | 本报告保存了开发前 `git status --short --branch` 快照。 |
| `P0-002` | 不可勾选 | 已枚举范围，但文件最终归属仍需用户确认；所有内容继续按用户工作保护。 |
| `P0-003` | 不可勾选 | 忽略规则基本覆盖，但根 `.DS_Store` 仍被跟踪，且清理脚本会删除私人目录。 |
| `P0-004` | 不可勾选 | 已证明两个文件字节相同，但迁移提交和其他官方附件边界尚未确认。 |
| `P0-005` | 不可勾选 | 已提出切片，尚未创建任何模板原子提交。 |
| `P0-006` | 可勾选（本机快照） | 远程 URL、分支和本机上游基线已记录；远端最新性仍需恢复联网认证后另验。 |
| `P0-007` | 不可勾选 | GitHub CLI token 无效。 |
| `P0-010` | 不可勾选 | 本次未运行四组回归。 |
| `P0-011` | 不可勾选 | 本次未执行文字提取、150+ DPI 渲染和 CJK 门禁。 |
| `P0-012` | 不可勾选 | 本次未进行单页 100% 视觉检查。 |
| `P0-013` | 不可勾选 | 只有历史 QA；本次四道状态门没有重新记录。 |
| `P0-014` | 不可勾选 | Schema 为 v0.2，但渲染器均未进入可定位的模板基线提交。 |
| `P0-015` | 部分完成，不可勾选 | 本报告给出初步三类边界；学校文件再分发性和二进制元数据仍待确认。 |

P0 阶段三个总体验收项目前均不可勾选：模板原型尚无可定位提交；回归与目标编辑器证据未重新建立；尽管 Electron 代码已被明确放到独立仓库，当前模板仓库仍需先完成安全保护。

## 8. 下一动作（按顺序）

1. 立即保持源仓库只读，禁用 `texclear.sh`/`git clean -X/-x`。
2. 对 `references/private/` 做可恢复备份并记录 73 个文件的清单与哈希；备份动作需在明确授权和安全目标路径后执行。
3. 修正清理脚本和 `.DS_Store` 跟踪问题，先提交安全片。
4. 由用户确认两个官方文件按精确 rename 保留，以及其余学校附件的公开/仅本地策略。
5. 按第 6 节逐片提交模板原型，得到 Schema/渲染器基线 commit。
6. 固定 Python 依赖后运行四组回归，严格分开记录内容、字形、逐页版式和 Word/WPS 四道门。
7. 恢复 `gh` 登录，fetch 后重新确认上游基线，再规划单主题 PR。
