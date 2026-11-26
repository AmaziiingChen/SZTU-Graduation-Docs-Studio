export type HelpCategoryId =
  | "install"
  | "authoring"
  | "references"
  | "export"
  | "troubleshooting"

export type HelpCategory = {
  id: HelpCategoryId
  label: string
}

export type HelpArticle = {
  id: string
  category: HelpCategoryId
  title: string
  summary: string
  keywords: string[]
  body: string[]
}

export const helpCategories: HelpCategory[] = [
  { id: "install", label: "安装与更新" },
  { id: "authoring", label: "填写与编辑" },
  { id: "references", label: "文献" },
  { id: "export", label: "预览与导出" },
  { id: "troubleshooting", label: "疑难排查" },
]

export const helpArticles: HelpArticle[] = [
  {
    id: "install-first-run",
    category: "install",
    title: "安装后第一次打开",
    summary: "安装包里已经带了编译引擎、PDF 工具和模板字体，直接打开就能用。",
    keywords: ["安装", "首次", "启动", "TeX", "字体", "依赖"],
    body: [
      "安装完成后从开始菜单打开「SZTU 文档工作台」即可，不需要再安装 TeX、字体或 Office。",
      "第一次打开时，右上角会出现简短的三步引导：先填档案，再新建文档，最后预览导出。跟着点一遍就能上手；不想看可以点「跳过引导」。",
      "左侧「基本信息」里的姓名、学号、学院、专业、导师只需要填一次，之后新建的每份材料都会自动带出。",
      "如果第一次打开时窗口是空白的，请先在任务栏找到它并稍等几秒；仍然空白就关掉重开。反复出现请用「帮助 → 反馈」告诉我们，并附上诊断编号。",
    ],
  },
  {
    id: "install-update",
    category: "install",
    title: "更新到新版本",
    summary: "有新版本时打开应用会看到提示；下载后点「安装并重启」即可。",
    keywords: ["更新", "升级", "新版本", "下载", "重启", "安装包"],
    body: [
      "软件每半小时检查一次新版本。发现有更新时，右下角会弹出提示，点「下载更新」开始下载。",
      "下载完成后按钮会变成「安装并重启」。点击后还会再确认一次：应用会先保存当前文档，然后退出并静默安装，装完自动重新打开。",
      "安装期间请不要关机或断电。如果安装没有完成，下次打开会说明原因，旧版本仍然可以继续使用。",
      "0.1.13–0.1.15 的老版本因为下载超时缺陷，可能一直下载不动；请到发布页手动下载最新安装包覆盖安装，文档不会丢。",
      "更新失败常见原因：网络中断、安全软件拦截安装程序、安装目录没有写权限。可以先重试一次；仍失败就手动下载安装包。",
    ],
  },
  {
    id: "profile-fields",
    category: "authoring",
    title: "基本信息怎么填",
    summary: "姓名、学号、学院、专业、导师与论文题目填一次，所有材料共用。",
    keywords: ["档案", "姓名", "学号", "学院", "专业", "导师", "论文题目"],
    body: [
      "在左侧点「基本信息」进入表单。姓名、学号、学院、专业、届别、班级、导师和论文题目填好后会自动保存。",
      "学号请按学校格式完整填写，导出时会原样带到材料封面和表格里。",
      "论文题目只在这里维护一份：任务书、开题报告、中期检查会共用同一个题目，改一处即可。",
      "导师可以添加多位，分别填写姓名与职称；导出时按模板要求显示。",
      "如果某些字段显示为未填，右侧结构提示会标出缺哪一项，点过去补上即可，不需要找保存按钮——输入后会自动保存。",
    ],
  },
  {
    id: "authoring-new-document",
    category: "authoring",
    title: "新建文档与逐项填写",
    summary: "左侧选择材料类型，点右侧加号新建，按结构提示逐项填写。",
    keywords: ["新建", "任务书", "开题报告", "中期检查", "填写", "结构提示"],
    body: [
      "左侧按材料类型分组：任务书、开题报告、中期检查、毕业论文、四类评审表。点分组右侧的加号新建一份。",
      "新建后会进入写作页，右侧「结构提示」列出这一类的必填章节，绿色勾表示已填写，灰色表示还没写。",
      "正文按段落输入即可，列表用工具栏按钮切换；需要插图时点图片按钮，选择本机图片。",
      "保存是自动的，底部会显示「已保存」。切换文档或关闭窗口前，如果还有未保存内容，软件会先保存再离开。",
      "毕业论文不在这里编辑：分组里提供「下载 LaTeX 模板」，下载后在自己的编辑器里排版。模板基于 GitHub 上游仓库 SZTU-ACM/SZTU-Thesis-Latex-Template 修改。",
    ],
  },
  {
    id: "references-bibtex",
    category: "references",
    title: "粘贴与管理参考文献（BibTeX）",
    summary: "支持直接粘贴 BibTeX；空值会当场提示；旧版段落式引用仍可导出。",
    keywords: ["文献", "参考文献", "BibTeX", "空值", "引用", "空字段"],
    body: [
      "任务书和开题报告的「参考文献」章节可以粘贴 BibTeX。粘贴后软件会解析成条目列表，支持逐条编辑、上移/下移和删除。",
      "如果某条文献的字段写成空值（例如 pages = {}），粘贴时就会提示「字段 pages 是空值」，并指出是第几条；删掉这一行或填上真实页码即可。",
      "解析成功后，导出用的参考文献会与列表保持一致；导出前还会再检查一次条目数量。",
      "以前保存过的旧文档只有段落式引用，没有 BibTeX 源，界面会显示「已保留旧版参考文献」并保持只读；这类内容仍然可以正常导出。粘贴一份有效 BibTeX 并保存后，会整份替换旧列表。",
      "如果 BibTeX 里有语法错误，解析失败不会覆盖上一份有效引用；修好再粘贴即可。",
    ],
  },
  {
    id: "references-format",
    category: "references",
    title: "参考文献著录格式",
    summary: "导出遵循 GB/T 7714—2025 顺序编码制，中文条目全角标点、西文半角。",
    keywords: ["GB/T 7714", "著录", "格式", "页码", "标点", "作者"],
    body: [
      "PDF 导出使用学校模板内置的 GB/T 7714—2025 参考文献样式，按正文引用顺序编号。",
      "中文条目使用全角标点，西文条目使用半角标点；作者超过三位时会按规范省略。",
      "专著、会议录析出文献的页码前用冒号（如 2023：101-108），期刊卷期与页码也按模板规则拼接。",
      "界面里的文献预览与实际 PDF 由两套实现渲染；如果发现预览和 PDF 不一致，请把 BibTeX 片段和截图通过「帮助 → 反馈」发给我们。",
    ],
  },
  {
    id: "export-preview",
    category: "export",
    title: "预览与导出 PDF / Word",
    summary: "先预览确认分页，再导出；PDF 为最终版式，推荐提交 PDF。",
    keywords: ["预览", "导出", "PDF", "Word", "分页", "排版"],
    body: [
      "点右上角「预览&导出」打开预览面板，第一次会生成预览，稍等几秒即可看到分页效果。",
      "预览通过后点「导出」，选择「导出 PDF（推荐）」或「导出 Word」。PDF 是最终版式；Word 方便继续编辑，但打开后可能因字体或 Word 版本出现细微差异。",
      "导出前会先做内容检查；如果有必填章节、图片或参考文献问题，会指出具体位置并阻止导出。",
      "导出文件会保存在你选择的文件夹里。如果打开失败或版式异常，请确认用的是最新版本，并尝试重新导出。",
    ],
  },
  {
    id: "export-fonts",
    category: "export",
    title: "字体与 Word/WPS 显示",
    summary: "安装包已内置模板字体；PDF 不受本机字体影响，Word 仍需要本机有对应字体。",
    keywords: ["字体", "华文中宋", "楷体", "Wingdings", "Word", "WPS"],
    body: [
      "打包时已把论文模板与任务书需要的字体收进安装包，首次启动会注册到当前 Windows 用户，所以 PDF 导出不依赖你手动安装字体。",
      "Word 文档只记录字体名称，打开时由 Word/WPS 使用本机字体显示。如果本机没有对应字体，Word 里可能看到替代字形；这不影响 PDF。",
      "任务书的勾选框使用 Wingdings 2；安装包已内置，缺失时会提示重新运行安装包修复。",
      "如果导出 PDF 时提示缺少字体，请重新运行最新安装包修复后再试。",
    ],
  },
  {
    id: "troubleshooting-preview",
    category: "troubleshooting",
    title: "预览或导出失败怎么办",
    summary: "先看提示里的原因；图片丢失、保存位置受限和内容检查是最常见的三类。",
    keywords: ["预览失败", "导出失败", "报错", "图片", "权限", "磁盘"],
    body: [
      "提示会直接说明原因，例如「文档里插入的图片文件找不到了」「没有权限写入保存位置」或「参考文献第 N 条有空值」。按提示处理后重试即可。",
      "如果提示图片找不到：回到正文里删除那张图，重新插入一次；图片文件可能被移动或删除了。",
      "如果提示无法写入：换一个保存位置（例如桌面或文档目录），避免 U 盘、网络盘或只读目录。",
      "如果反复失败：点「创建诊断包」生成一个压缩包，再通过「帮助 → 反馈」把诊断编号发给我们。诊断包只保存在本机，发送前会显示内容清单。",
      "内容检查未通过时，预览面板会显示同一条原因；按提示改完再点「重新生成预览」。",
    ],
  },
  {
    id: "troubleshooting-paths",
    category: "troubleshooting",
    title: "中文路径、保存位置与磁盘空间",
    summary: "安装路径可以含中文；保存位置建议用本机磁盘的普通文件夹。",
    keywords: ["中文路径", "保存位置", "U 盘", "网络盘", "磁盘空间", "OneDrive"],
    body: [
      "安装目录可以包含中文和空格；编译引擎单独安装在系统目录，与安装位置无关。",
      "导出时请选择本机磁盘上的普通文件夹。U 盘（尤其是 exFAT）、网络共享盘和同步目录可能造成写入失败或文件被锁。",
      "磁盘剩余空间不足时，导出会在检查阶段停止；清理一些空间后重试。",
      "如果文档很长或图片很多，导出时间会变长；超过等待时间会提示超时，可以先减少图片或拆分内容。",
    ],
  },
  {
    id: "demo-documents",
    category: "troubleshooting",
    title: "演示资料是什么",
    summary: "一套虚构的任务书、开题报告与中期检查，可随时载入或清除。",
    keywords: ["演示", "示例", "样例", "参考", "载入", "清除"],
    body: [
      "帮助页里的「载入演示资料」会向当前档案写入三份虚构材料：任务书、开题报告、中期检查，标题都以「参考样例·」开头。",
      "演示资料只用于照着看结构和写法，不会覆盖你自己的文档，也不会自动出现在新安装里。",
      "「清除演示资料」只删除标题以「参考样例·」开头的文档，你自己的文档不受影响。",
      "演示内容中的人物、学号与经历均为虚构，参考文献来自公开资料。",
    ],
  },
]

export type HelpSearchHit = {
  article: HelpArticle
  snippet: string
}

function snippetFor(article: HelpArticle, query: string): string {
  const needle = query.trim().toLowerCase()
  const lines = [article.summary, ...article.body]
  const matched = lines.find((line) => line.toLowerCase().includes(needle))
  if (!matched) return article.summary
  const index = matched.toLowerCase().indexOf(needle)
  const start = Math.max(0, index - 24)
  const end = Math.min(matched.length, index + needle.length + 40)
  return `${start > 0 ? "…" : ""}${matched.slice(start, end)}${end < matched.length ? "…" : ""}`
}

export function searchHelp(query: string): HelpSearchHit[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return helpArticles.map((article) => ({ article, snippet: article.summary }))
  const terms = raw.split(/\s+/).filter(Boolean)
  return helpArticles
    .map((article) => ({ article, haystack: [article.title, article.summary, article.keywords.join(" "), article.body.join(" ")].join(" ").toLowerCase() }))
    .filter(({ haystack }) => terms.every((term) => haystack.includes(term)))
    .map(({ article }) => ({ article, snippet: snippetFor(article, raw) }))
}

export const keyboardShortcuts: Array<{ keys: string; action: string }> = [
  { keys: "Ctrl + /", action: "打开帮助与快捷键" },
  { keys: "Ctrl + S", action: "立即保存当前文档" },
  { keys: "Esc", action: "关闭弹窗或退出新手引导" },
]

export type ReleaseNote = {
  version: string
  date: string
  items: string[]
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: "0.2.0",
    date: "2026-11-26",
    items: [
      "安装包内置全部模板字体，首次启动自动注册，纯净电脑不再缺字体。",
      "文献空值在粘贴时即时报错，并说明是第几条、哪个字段。",
      "错误提示改成人话，技术细节只进入诊断信息。",
      "下载更新后可一键安装并自动重启。",
      "首次打开不再弹出环境检查清单。",
    ],
  },
  {
    version: "0.1.19",
    date: "2026-11-23",
    items: [
      "安装包收进方正小标宋、华文中宋与华文行楷，任务书与中期检查不再缺字。",
      "修复部分中文字体在纯净 Windows 上导出缺字的问题。",
    ],
  },
  {
    version: "0.1.18",
    date: "2026-11-20",
    items: [
      "首次启动提供引导，帮助新用户完成环境准备。",
      "修复更新服务在多网络环境下的检查失败。",
    ],
  },
]
