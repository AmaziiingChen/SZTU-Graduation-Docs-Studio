import { ExternalLinkIcon as ExternalLinkIconAnimated } from "@/components/ui/external-link"
import { RefreshCWIcon as RefreshCwIconAnimated } from "@/components/ui/refresh-cw"
import { AnimatedActionIcon } from "@/components/workbench/animated-action-icon"
import { CircleAlertIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { SectionCompletionMark } from "@/components/workbench/section-completion-mark"
import type {
  EnvironmentCheck,
  EnvironmentResult,
  ToolLinkId,
} from "@/types/desktop-api"

export type EnvironmentOnboardingState =
  | { status: "loading" }
  | { status: "ready"; result: EnvironmentResult }
  | { status: "error"; message: string }

const PRIMARY_CHECK_IDS = new Set([
  "core_document_fonts",
  "special_document_fonts",
  "task_book_docx_font",
  "xelatex",
  "process_tex_packages",
  "thesis_toolchain",
  "thesis_tex_packages",
  "pdf_tools",
  "office_editor",
])

const CHECK_TITLES: Record<string, string> = {
  core_document_fonts: "基础文档字体",
  special_document_fonts: "模板专用字体",
  task_book_docx_font: "任务书 Word 字体",
  xelatex: "XeLaTeX",
  process_tex_packages: "过程文档 TeX 宏包",
  thesis_toolchain: "毕业论文编译工具",
  thesis_tex_packages: "毕业论文 TeX 宏包",
  pdf_tools: "PDF 分页工具",
  office_editor: "Word/WPS",
  python: "应用运行组件",
  temporary_directory: "本机临时目录",
  document_dependencies: "文档生成组件",
  template_pack: "受信任模板",
  proposal_engine: "开题报告模板",
  task_book_engine: "任务书模板",
  midterm_engine: "中期检查模板",
}

type InstallationGuide = {
  description: string
  linkId?: ToolLinkId
  linkLabel?: string
}

function installationGuide(
  check: EnvironmentCheck,
  system: string,
): InstallationGuide | undefined {
  const isMac = system === "Darwin"
  switch (check.id) {
    case "xelatex":
    case "process_tex_packages":
    case "thesis_toolchain":
    case "thesis_tex_packages":
      return {
        description: isMac
          ? "安装 MacTeX；安装完成后重启本软件，再重新检查。"
          : "安装 TeX Live，并确保 XeLaTeX、BibTeX 和 latexmk 已加入 PATH；完成后重启本软件。",
        linkId: isMac ? "mactex" : "texlive",
        linkLabel: "打开 TeX 安装页面",
      }
    case "pdf_tools":
      return {
        description: isMac
          ? "安装 Poppler PDF 工具；使用 Homebrew 时可执行 brew install poppler。"
          : "安装适用于 Windows 的 Poppler 工具，并将其 bin 目录加入 PATH。",
        linkId: isMac ? "homebrew-poppler" : "poppler",
        linkLabel: "查看 Poppler 安装说明",
      }
    case "core_document_fonts":
    case "special_document_fonts":
    case "task_book_docx_font":
      return {
        description:
          "请从你合法使用的 Windows、Office、WPS、macOS 或学校软件环境安装缺失字体；本软件不会分发商业字体。",
        linkId: isMac ? "font-book-help" : "windows-font-help",
        linkLabel: "查看字体安装方法",
      }
    case "office_editor":
      return {
        description: "安装 Microsoft Word 或 WPS，用于最终打开和验收 DOCX。",
        linkId: "wps-office",
        linkLabel: "打开 WPS 下载页面",
      }
    default:
      return undefined
  }
}

function visibleChecks(result: EnvironmentResult): EnvironmentCheck[] {
  return result.checks.filter(
    (check) => PRIMARY_CHECK_IDS.has(check.id) || check.status !== "pass",
  )
}

function statusBadge(check: EnvironmentCheck) {
  if (check.status === "fail") {
    return <Badge variant="destructive">缺失</Badge>
  }
  return <Badge variant="outline">建议处理</Badge>
}

function platformName(system: string): string {
  if (system === "Darwin") return "macOS"
  if (system === "Windows") return "Windows"
  return system
}

export function EnvironmentOnboardingDialog({
  open,
  environment,
  onRefresh,
  onComplete,
  onQuit,
  onOpenGuide,
}: {
  open: boolean
  environment: EnvironmentOnboardingState
  onRefresh: () => void
  onComplete: () => void
  onQuit: () => void
  onOpenGuide: (toolId: ToolLinkId) => void
}) {
  const result = environment.status === "ready" ? environment.result : undefined
  const checks = result ? visibleChecks(result) : []
  const warningCount = result
    ? result.checks.filter((check) => check.status === "warn").length
    : 0
  const failureCount = result
    ? result.checks.filter((check) => check.status === "fail").length
    : 0

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>准备本机文档环境</DialogTitle>
          <DialogDescription>
            首次使用会检查字体、TeX、PDF 工具和 Word/WPS；不会读取或上传你的文档内容。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0">
          {environment.status === "loading" ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="animate-spin" />
              正在检查本机环境
            </div>
          ) : environment.status === "error" ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>环境检查未完成</AlertTitle>
              <AlertDescription>{environment.message}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid min-h-0 gap-3">
              {environment.result.ready ? (
                <Alert className="pr-12">
                  <AlertTitle>基础环境可以使用</AlertTitle>
                  <AlertDescription>
                    已检查 {platformName(environment.result.platform.system)} 本机环境
                    {warningCount > 0
                      ? `；另有 ${warningCount} 项建议补充，不阻止进入工作台。`
                      : "，可以进入工作台。"}
                  </AlertDescription>
                  <AlertAction className="top-1/2 -translate-y-1/2">
                    <SectionCompletionMark
                      state="complete"
                      completeLabel="环境检查通过"
                      className="ml-0"
                      animateOnMount
                    />
                  </AlertAction>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>还有 {failureCount} 项必要环境缺失</AlertTitle>
                  <AlertDescription>
                    你可以按下方指引安装后重新检查，也可以稍后配置；缺失环境对应的预览和导出功能会保持不可用。
                  </AlertDescription>
                </Alert>
              )}

              <ScrollArea className="max-h-[min(26rem,55dvh)] rounded-lg border">
                <div className="grid">
                  {checks.map((check, index) => {
                    const guide =
                      check.status === "pass"
                        ? undefined
                        : installationGuide(
                            check,
                            environment.result.platform.system,
                          )
                    const guideLinkId = guide?.linkId
                    return (
                      <div key={check.id}>
                        {index > 0 ? <Separator /> : null}
                        <div
                          className={
                            check.status === "pass"
                              ? "flex min-h-11 items-center gap-2 px-3 py-2"
                              : "grid gap-2 p-3"
                          }
                        >
                          <div className="flex w-full items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2">
                              {check.status !== "pass" ? (
                                <CircleAlertIcon className="mt-0.5" />
                              ) : null}
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {CHECK_TITLES[check.id] ?? check.id}
                                </p>
                                {check.status !== "pass" ? (
                                  <p className="text-xs text-muted-foreground">
                                    {check.message}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            {check.status === "pass" ? (
                              <SectionCompletionMark
                                state="complete"
                                completeLabel={`${CHECK_TITLES[check.id] ?? check.id}通过`}
                                animateOnMount
                              />
                            ) : (
                              statusBadge(check)
                            )}
                          </div>
                          {guide ? (
                            <div className="grid gap-2 pl-6">
                              <p className="text-xs text-muted-foreground">
                                {guide.description}
                              </p>
                              {guideLinkId && guide.linkLabel ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-fit"
                                  onClick={() => onOpenGuide(guideLinkId)}
                                >
                                  <AnimatedActionIcon icon={ExternalLinkIconAnimated} />
                                  {guide.linkLabel}
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          {environment.status === "error" ? (
            <>
              <Button variant="outline" onClick={onQuit}>
                退出应用
              </Button>
              <Button onClick={onRefresh}>
                <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                重新检查
              </Button>
            </>
          ) : environment.status === "ready" ? (
            <>
              <Button variant="outline" onClick={onRefresh}>
                <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                重新检查
              </Button>
              <Button onClick={onComplete}>
                {environment.result.ready ? "进入工作台" : "稍后配置"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
