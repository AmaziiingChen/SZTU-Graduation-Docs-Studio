import deeplIcon from "@/assets/tool-icons/deepl.svg"
import deepseekIcon from "@/assets/tool-icons/deepseek.svg"
import doubaoIcon from "@/assets/tool-icons/doubao.svg"
import drawIoIcon from "@/assets/tool-icons/draw-io.svg"
import easyScholarIcon from "@/assets/tool-icons/easyscholar.jpg"
import geminiIcon from "@/assets/tool-icons/gemini.svg"
import immersiveTranslateIcon from "@/assets/tool-icons/immersive-translate.svg"
import islideIcon from "@/assets/tool-icons/islide.ico"
import metasoIcon from "@/assets/tool-icons/metaso.png"
import perplexityIcon from "@/assets/tool-icons/perplexity.svg"
import qwenIcon from "@/assets/tool-icons/qwen.svg"
import seekAllIcon from "@/assets/tool-icons/seekall.png"
import simpleTexIcon from "@/assets/tool-icons/simpletex.ico"
import tabbitIcon from "@/assets/tool-icons/tabbit.ico"
import vCaptionsIcon from "@/assets/tool-icons/vcaptions.png"
import voyagerIcon from "@/assets/tool-icons/voyager.png"
import xmindIcon from "@/assets/tool-icons/xmind.png"
import zoteroIcon from "@/assets/tool-icons/zotero.svg"
import type { ToolLinkId } from "@/types/desktop-api"

export type { ToolLinkId } from "@/types/desktop-api"
export type ToolCategory = "效率工具" | "浏览器扩展" | "文献管理" | "AI 工具"
export type ToolKind = "网站" | "应用" | "浏览器扩展"

export type ToolDirectoryItem = {
  id: ToolLinkId
  name: string
  description: string
  category: ToolCategory
  kind: ToolKind
  icon: string
}

export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  "效率工具",
  "浏览器扩展",
  "文献管理",
  "AI 工具",
]

export const TOOL_DIRECTORY: ToolDirectoryItem[] = [
  {
    id: "xmind",
    name: "Xmind",
    description: "用思维导图梳理论文结构、研究问题与写作计划。",
    category: "效率工具",
    kind: "应用",
    icon: xmindIcon,
  },
  {
    id: "draw-io",
    name: "draw.io",
    description: "在线绘制流程图、技术路线图和系统结构图。",
    category: "效率工具",
    kind: "网站",
    icon: drawIoIcon,
  },
  {
    id: "simpletex",
    name: "SimpleTex",
    description: "识别图片中的公式，并转换为可编辑的 LaTeX。",
    category: "效率工具",
    kind: "网站",
    icon: simpleTexIcon,
  },
  {
    id: "tabbit",
    name: "Tabbit 浏览器",
    description: "面向学习与研究场景组织网页、资料和浏览任务。",
    category: "效率工具",
    kind: "应用",
    icon: tabbitIcon,
  },
  {
    id: "deepl",
    name: "DeepL",
    description: "辅助翻译论文摘要、外文资料与学术表达。",
    category: "效率工具",
    kind: "网站",
    icon: deeplIcon,
  },
  {
    id: "islide",
    name: "iSlide",
    description: "制作答辩演示文稿并统一版式与图表表达。",
    category: "效率工具",
    kind: "应用",
    icon: islideIcon,
  },
  {
    id: "seekall",
    name: "SeekAll",
    description: "聚合搜索当前页面和常用搜索服务，提高资料查找效率。",
    category: "浏览器扩展",
    kind: "浏览器扩展",
    icon: seekAllIcon,
  },
  {
    id: "vcaptions",
    name: "vCaptions",
    description: "为网页视频生成字幕列表，便于定位和整理视频内容。",
    category: "浏览器扩展",
    kind: "浏览器扩展",
    icon: vCaptionsIcon,
  },
  {
    id: "voyager",
    name: "Voyager",
    description: "集中发现和管理浏览器增强插件与网页工具。",
    category: "浏览器扩展",
    kind: "浏览器扩展",
    icon: voyagerIcon,
  },
  {
    id: "immersive-translate",
    name: "沉浸式翻译",
    description: "双语对照翻译网页、PDF 和在线视频字幕。",
    category: "浏览器扩展",
    kind: "浏览器扩展",
    icon: immersiveTranslateIcon,
  },
  {
    id: "easyscholar",
    name: "easyScholar",
    description: "查询期刊信息与学术评价数据，辅助文献筛选。",
    category: "浏览器扩展",
    kind: "浏览器扩展",
    icon: easyScholarIcon,
  },
  {
    id: "zotero",
    name: "Zotero",
    description: "收集、整理、标注文献，并管理引用与参考文献。",
    category: "文献管理",
    kind: "应用",
    icon: zoteroIcon,
  },
  {
    id: "metaso",
    name: "秘塔 AI 搜索",
    description: "面向问题检索和汇总网页资料，快速形成研究线索。",
    category: "AI 工具",
    kind: "网站",
    icon: metasoIcon,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "基于网页来源回答问题，并提供可继续核查的引用链接。",
    category: "AI 工具",
    kind: "网站",
    icon: perplexityIcon,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "辅助理解问题、整理思路、解释代码与改写文字。",
    category: "AI 工具",
    kind: "网站",
    icon: deepseekIcon,
  },
  {
    id: "doubao",
    name: "豆包",
    description: "提供对话、阅读、写作和多模态内容处理能力。",
    category: "AI 工具",
    kind: "网站",
    icon: doubaoIcon,
  },
  {
    id: "qianwen",
    name: "千问",
    description: "辅助问答、资料理解、写作与日常学习任务。",
    category: "AI 工具",
    kind: "网站",
    icon: qwenIcon,
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "辅助跨语言问答、资料理解与多模态内容分析。",
    category: "AI 工具",
    kind: "网站",
    icon: geminiIcon,
  },
]
