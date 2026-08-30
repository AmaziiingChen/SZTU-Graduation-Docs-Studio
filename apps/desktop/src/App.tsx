import { useCallback, useEffect, useRef, useState } from "react"
import {
  AppWindowIcon,
  BracesIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  FileCheck2Icon,
  FileClockIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderCheckIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  SaveIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react"

import { AppSidebar } from "@/components/workbench/app-sidebar"
import { SiteHeader } from "@/components/workbench/site-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { Textarea } from "@/components/ui/textarea"
import { useIsMobile } from "@/hooks/use-mobile"
import { toast } from "sonner"

import type {
  CheckResult,
  DocumentRecord,
  DocumentType,
  EnvironmentCheck,
  EnvironmentResult,
  ExportArtifactRecord,
  ExportFormat,
  ExportJobSummary,
  ExportReceipt,
  JsonObject,
  StudentProfile,
  StudentProfileInput,
  SztuDesktopApi,
  WorkspaceMode,
  WorkspaceState as WorkspaceSnapshot,
} from "@/types/desktop-api"

type Draft = {
  title: string
  studentName: string
  studentId: string
  major: string
  college: string
  advisor: string
  significance: string
  researchContent: string
  methods: string
  steps: string
  references: string
  className: string
  checkDate: string
  directory: string
  mainResearchContent: string
  progress: string
}

type SaveState =
  | "loading"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"

type ExportState =
  | { status: "idle" }
  | {
      status: "exporting"
      formats: ExportFormat[]
      requestId: string
      cancelRequested: boolean
    }
  | { status: "succeeded"; receipt: ExportReceipt }
  | { status: "error"; message: string }

type ExportHistoryState =
  | { status: "loading"; jobs: ExportJobSummary[] }
  | { status: "ready"; jobs: ExportJobSummary[] }
  | { status: "error"; jobs: ExportJobSummary[]; message: string }

type PendingExport = {
  requestId: string
  documentId: string
  outputDirectory: string
  formats: ExportFormat[]
  preflightToken: string
}

type QaTarget = {
  artifact: ExportArtifactRecord
}

type WorkspaceLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

type ActivePane = "profile" | "document"

type EnvironmentState =
  | { status: "loading" }
  | { status: "ready"; result: EnvironmentResult }
  | { status: "error"; message: string }

async function loadEnvironmentState(): Promise<EnvironmentState> {
  const api = getDesktopApi()
  if (!api) {
    return {
      status: "error",
      message: "请在 Electron 桌面应用中运行工作台。",
    }
  }
  try {
    const result = await api.checkEnvironment()
    return { status: "ready", result }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "环境检查失败。",
    }
  }
}

const emptyDraft: Draft = {
  title: "",
  studentName: "",
  studentId: "",
  major: "",
  college: "",
  advisor: "",
  significance: "",
  researchContent: "",
  methods: "",
  steps: "",
  references: "",
  className: "",
  checkDate: "",
  directory: "",
  mainResearchContent: "",
  progress: "",
}

function getDesktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

function errorHasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  )
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function isDraft(value: unknown): value is Partial<Draft> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function paragraphsValue(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n\n")
    : ""
}

function splitParagraphs(value: string): string[] {
  const normalized = value.trim()
  return normalized
    ? normalized.split(/\n\s*\n/).map((paragraph) => paragraph.trim())
    : []
}

function directoryItems(value: string): JsonObject[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.map((line) => {
    const match = /^(\d+(?:\.\d+){0,3})\s+(.+)$/.exec(line)
    if (!match) return { level: 0, number: "", title: "" }
    return {
      level: match[1].split(".").length,
      number: match[1],
      title: match[2].trim(),
    }
  })
}

function contentBlocks(value: string): JsonObject[] {
  return splitParagraphs(value).map((text) => ({
    type: "paragraph",
    runs: [{ text }],
  }))
}

function draftIsExportReady(draft: Draft, documentType: DocumentType): boolean {
  if (!profileIsComplete(draft)) return false
  if (documentType === "midterm") {
    const directory = directoryItems(draft.directory)
    return (
      [draft.title, draft.checkDate].every((value) => value.trim().length > 0) &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.checkDate) &&
      directory.length > 0 &&
      directory.every(
        (item) =>
          typeof item.level === "number" &&
          item.level >= 1 &&
          item.level <= 4 &&
          typeof item.title === "string" &&
          item.title.length > 0,
      ) &&
      splitParagraphs(draft.mainResearchContent).length > 0 &&
      splitParagraphs(draft.progress).length > 0
    )
  }
  return (
    draft.title.trim().length > 0 &&
    splitParagraphs(draft.significance).length >= 2 &&
    [
      draft.researchContent,
      draft.methods,
      draft.steps,
      draft.references,
    ].every((value) => splitParagraphs(value).length >= 1)
  )
}

function draftToContent(draft: Draft, documentType: DocumentType): JsonObject {
  if (documentType === "midterm") {
    return {
      metadata: {
        title: draft.title,
        student_name: draft.studentName,
        college: draft.college,
        major: draft.major,
        class_name: draft.className,
        advisor: draft.advisor,
        check_date: draft.checkDate,
      },
      sections: {
        directory: directoryItems(draft.directory),
        main_research_content: contentBlocks(draft.mainResearchContent),
        progress: contentBlocks(draft.progress),
      },
    }
  }
  return {
    metadata: {
      title: draft.title,
      student_name: draft.studentName,
      student_id: draft.studentId,
      major: draft.major,
      college: draft.college,
      advisor: draft.advisor,
    },
    sections: {
      significance_and_status: splitParagraphs(draft.significance),
      research_content: splitParagraphs(draft.researchContent),
      methods_and_means: splitParagraphs(draft.methods),
      research_steps: splitParagraphs(draft.steps),
      references: splitParagraphs(draft.references),
    },
  }
}

function draftFromRecords(
  profile: StudentProfile | null,
  document: DocumentRecord,
  fallback?: Draft,
): Draft {
  const content = recordValue(document.content)
  const metadata = recordValue(content.metadata)
  const sections = recordValue(content.sections)
  const legacyContent = isDraft(document.content) ? document.content : {}
  return {
    ...emptyDraft,
    ...fallback,
    ...legacyContent,
    title: textValue(metadata.title) || legacyContent.title || fallback?.title || "",
    studentName:
      profile?.full_name ||
      textValue(metadata.student_name) ||
      legacyContent.studentName ||
      fallback?.studentName ||
      "",
    studentId:
      profile?.student_number ||
      textValue(metadata.student_id) ||
      legacyContent.studentId ||
      fallback?.studentId ||
      "",
    college:
      profile?.college ||
      textValue(metadata.college) ||
      legacyContent.college ||
      fallback?.college ||
      "",
    major:
      profile?.major ||
      textValue(metadata.major) ||
      legacyContent.major ||
      fallback?.major ||
      "",
    advisor:
      profile?.advisor_name ||
      textValue(metadata.advisor) ||
      legacyContent.advisor ||
      fallback?.advisor ||
      "",
    significance:
      paragraphsValue(sections.significance_and_status) ||
      legacyContent.significance ||
      fallback?.significance ||
      "",
    researchContent:
      paragraphsValue(sections.research_content) ||
      legacyContent.researchContent ||
      fallback?.researchContent ||
      "",
    methods:
      paragraphsValue(sections.methods_and_means) ||
      legacyContent.methods ||
      fallback?.methods ||
      "",
    steps:
      paragraphsValue(sections.research_steps) ||
      legacyContent.steps ||
      fallback?.steps ||
      "",
    references:
      paragraphsValue(sections.references) ||
      legacyContent.references ||
      fallback?.references ||
      "",
    className:
      profile?.class_name ||
      textValue(metadata.class_name) ||
      legacyContent.className ||
      fallback?.className ||
      "",
    checkDate:
      textValue(metadata.check_date) ||
      legacyContent.checkDate ||
      fallback?.checkDate ||
      "",
    directory:
      Array.isArray(sections.directory)
        ? sections.directory
            .map((item) => {
              const entry = recordValue(item)
              const number = textValue(entry.number)
              const title = textValue(entry.title)
              return [number, title].filter(Boolean).join(" ")
            })
            .filter(Boolean)
            .join("\n")
        : legacyContent.directory || fallback?.directory || "",
    mainResearchContent:
      contentBlocksValue(sections.main_research_content) ||
      legacyContent.mainResearchContent ||
      fallback?.mainResearchContent ||
      "",
    progress:
      contentBlocksValue(sections.progress) ||
      legacyContent.progress ||
      fallback?.progress ||
      "",
  }
}

function contentBlocksValue(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .map((item) => {
      const block = recordValue(item)
      if (block.type === "paragraph" && Array.isArray(block.runs)) {
        return block.runs
          .map((run) => textValue(recordValue(run).text))
          .join("")
      }
      if (block.type === "ordered_list" && Array.isArray(block.items)) {
        return block.items
          .map((rawItem, index) => {
            const entry = recordValue(rawItem)
            return `${textValue(entry.marker) || `${index + 1}、`}${textValue(entry.content)}`
          })
          .join("\n")
      }
      return ""
    })
    .filter(Boolean)
    .join("\n\n")
}

function currentRevision(document: DocumentRecord): number {
  return document.current_revision
}

function profileIsComplete(draft: Draft): boolean {
  return [
    draft.studentName,
    draft.studentId,
    draft.college,
    draft.major,
    draft.className,
    draft.advisor,
  ].every((value) => value.trim().length > 0)
}

function profileFromDraft(
  draft: Draft,
  current: StudentProfile | null,
): StudentProfileInput {
  return {
    ...(current?.id ? { id: current.id } : {}),
    full_name: draft.studentName.trim(),
    student_number: draft.studentId.trim(),
    college: draft.college.trim(),
    major: draft.major.trim(),
    class_name: draft.className.trim() || current?.class_name || "",
    advisor_name: draft.advisor.trim(),
  }
}

const checkIcons: Record<string, typeof BracesIcon> = {
  python: BracesIcon,
  temporary_directory: FolderCheckIcon,
  xelatex: FileTextIcon,
  office_editor: AppWindowIcon,
  template_pack: FileCheck2Icon,
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputType = "text",
  error,
  disabled,
}: {
  id: keyof Draft
  label: string
  value: string
  onChange: (field: keyof Draft, value: string) => void
  placeholder?: string
  inputType?: "text" | "date"
  error?: string
  disabled?: boolean
}) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={inputType}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(id, event.target.value)}
      />
      {error ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ParagraphField({
  id,
  label,
  value,
  onChange,
  description,
  disabled,
}: {
  id: keyof Draft
  label: string
  value: string
  onChange: (field: keyof Draft, value: string) => void
  description: string
  disabled?: boolean
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        className="min-h-32 resize-y"
        onChange={(event) => onChange(id, event.target.value)}
      />
    </div>
  )
}

function StudentProfileEditor({
  draft,
  onChange,
  disabled,
  workspace,
}: {
  draft: Draft
  onChange: (field: keyof Draft, value: string) => void
  disabled: boolean
  workspace: WorkspaceLoadState
}) {
  const complete = profileIsComplete(draft)
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-4xl gap-6 p-6">
        <p className="text-sm text-muted-foreground">
          基础信息只在这里维护一次，开题报告、中期检查和后续过程文档导出时统一读取。
        </p>

        {workspace.status === "loading" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在载入学生档案</AlertTitle>
            <AlertDescription>正在恢复本机保存的共用基础信息。</AlertDescription>
          </Alert>
        ) : null}

        {!complete && workspace.status === "ready" ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>请先补全学生档案</AlertTitle>
            <AlertDescription>
              姓名、学号、学院、专业、班级和指导教师完整后，过程文档才能检查和导出。
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>共用基础信息</CardTitle>
            <CardDescription>
              修改后会自动保存，并作为所有过程文档下一次检查与导出的唯一基础信息来源。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field
              id="studentName"
              label="学生姓名"
              value={draft.studentName}
              error={!draft.studentName.trim() ? "请输入学生姓名。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="studentId"
              label="学号"
              value={draft.studentId}
              error={!draft.studentId.trim() ? "请输入学号。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="college"
              label="学院"
              value={draft.college}
              error={!draft.college.trim() ? "请输入学院。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="major"
              label="专业"
              value={draft.major}
              error={!draft.major.trim() ? "请输入专业。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="className"
              label="班级"
              value={draft.className}
              error={!draft.className.trim() ? "请输入班级。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="advisor"
              label="指导教师"
              placeholder="只填写姓名，不填写职称"
              value={draft.advisor}
              error={!draft.advisor.trim() ? "请输入指导教师姓名。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
          </CardContent>
        </Card>

        <Alert>
          <FolderCheckIcon />
          <AlertTitle>档案与导出快照</AlertTitle>
          <AlertDescription>
            档案保存在本机；每次导出仍会冻结当时使用的基础信息和文档正文，便于追溯历史版本。
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  )
}

function DocumentEditor({
  documentType,
  draft,
  onChange,
  disabled,
  mode,
  workspace,
  saveState,
  onRetryLoad,
  onRetrySave,
}: {
  documentType: DocumentType
  draft: Draft
  onChange: (field: keyof Draft, value: string) => void
  disabled: boolean
  mode: WorkspaceMode
  workspace: WorkspaceLoadState
  saveState: SaveState
  onRetryLoad: () => void
  onRetrySave: () => void
}) {
  const isMidterm = documentType === "midterm"
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-4xl gap-6 p-6">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">
            {isMidterm ? "2026 届中期检查表" : "2026 届开题报告"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isMidterm
              ? "填写检查日期、论文目录、主要研究内容和进展；基础信息统一来自学生档案。"
              : "填写论文题目和结构化正文；基础信息统一来自学生档案。"}
          </p>
        </div>

        {!profileIsComplete(draft) && workspace.status === "ready" ? (
          <Alert>
            <UserRoundIcon />
            <AlertTitle>学生档案尚未补全</AlertTitle>
            <AlertDescription>
              请先在左侧“学生档案”填写共用基础信息，完成后再检查或导出当前文档。
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace.status === "loading" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在载入工作区</AlertTitle>
            <AlertDescription>
              正在恢复上次使用的学生档案和
              {isMidterm ? "中期检查表" : "开题报告"}。
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace.status === "error" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>工作区载入失败</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>{workspace.message}</span>
              <Button variant="outline" size="sm" onClick={onRetryLoad}>
                <RefreshCwIcon />
                重新载入
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {mode === "temporary" ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>临时模式</AlertTitle>
            <AlertDescription>
              当前内容仅保存在本次临时工作区。返回持久工作区时会明确丢弃。
            </AlertDescription>
          </Alert>
        ) : null}

        {saveState === "error" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>内容仍保留在当前窗口中，请检查文档引擎后重试。</span>
              <Button variant="outline" size="sm" onClick={onRetrySave}>
                <SaveIcon />
                重试保存
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {saveState === "conflict" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>修订冲突</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>另一份更新已先保存。请重新载入工作区，再决定如何处理当前内容。</span>
              <Button variant="outline" size="sm" onClick={onRetryLoad}>
                <RefreshCwIcon />
                重新载入
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>文档信息</CardTitle>
            <CardDescription>
              姓名、学号、学院、专业、班级和指导教师请在左侧“学生档案”统一维护。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className={isMidterm ? undefined : "md:col-span-2"}>
              <Field
                id="title"
                label="论文题目"
                value={draft.title}
                error={!draft.title.trim() ? "请输入论文题目。" : undefined}
                placeholder="请输入毕业论文（设计）题目"
                onChange={onChange}
                disabled={disabled}
              />
            </div>
            {isMidterm ? (
              <Field
                id="checkDate"
                label="检查日期"
                inputType="date"
                value={draft.checkDate}
                error={
                  /^\d{4}-\d{2}-\d{2}$/.test(draft.checkDate)
                    ? undefined
                    : "请选择有效的检查日期。"
                }
                onChange={onChange}
                disabled={disabled}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>报告内容</CardTitle>
            <CardDescription>
              草稿会在停止输入后自动保存；保存后可导出 Word、PDF 或两者。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {isMidterm ? (
              <>
                <ParagraphField
                  id="directory"
                  label="论文目录"
                  description="每行填写一项，例如：1 绪论、1.1 研究背景；支持 1 至 4 级目录。"
                  value={draft.directory}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="mainResearchContent"
                  label="论文主要研究内容"
                  description="空行分隔独立段落；当前工作台先开放普通段落输入。"
                  value={draft.mainResearchContent}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="progress"
                  label="毕业论文（设计）进展情况"
                  description="按实际完成情况填写，空行分隔独立段落。"
                  value={draft.progress}
                  onChange={onChange}
                  disabled={disabled}
                />
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>中期检查填写边界</AlertTitle>
                  <AlertDescription>
                    教师检查项、教师意见、审核小组意见、签名和日期不会由学生端代填；图片、列表和富文本能力暂未开放可视化编辑。
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <ParagraphField
                  id="significance"
                  label="本选题的意义及国内外发展状况"
                  description="正式合同要求至少两个段落。"
                  value={draft.significance}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="researchContent"
                  label="研究内容"
                  description="说明研究对象、主要问题和拟完成内容。"
                  value={draft.researchContent}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="methods"
                  label="研究方法与手段"
                  description="与研究步骤分开填写。"
                  value={draft.methods}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="steps"
                  label="研究步骤"
                  description="按实际推进顺序填写。"
                  value={draft.steps}
                  onChange={onChange}
                  disabled={disabled}
                />
                <ParagraphField
                  id="references"
                  label="参考文献"
                  description="每条文献后续会作为独立条目保存。"
                  value={draft.references}
                  onChange={onChange}
                  disabled={disabled}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}

function CheckRow({ check }: { check: EnvironmentCheck }) {
  const Icon = checkIcons[check.id] ?? FileCheck2Icon
  const variant =
    check.status === "fail"
      ? "destructive"
      : check.status === "warn"
        ? "secondary"
        : "outline"

  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{check.id}</span>
          <Badge variant={variant}>
            {check.status === "pass"
              ? "可用"
              : check.status === "warn"
                ? "受限"
                : "不可用"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{check.message}</p>
      </div>
    </div>
  )
}

function InspectionPanel({
  environment,
  onRefresh,
  onInstallTemplate,
  templateInstalling,
  checks,
  exportState,
  onCancelExport,
  history,
  onRefreshHistory,
  onOpenArtifact,
  onRecordQa,
}: {
  environment: EnvironmentState
  onRefresh: () => void
  onInstallTemplate: () => void
  templateInstalling: boolean
  checks: CheckResult[]
  exportState: ExportState
  onCancelExport: () => void
  history: ExportHistoryState
  onRefreshHistory: () => void
  onOpenArtifact: (artifactId: string) => void
  onRecordQa: (artifact: ExportArtifactRecord) => void
}) {
  const qualityChecks: Array<{ gate: CheckResult["gate"]; label: string }> = [
    { gate: "content", label: "内容检查" },
    { gate: "structure", label: "结构检查" },
    { gate: "cjk_glyph", label: "中文字形" },
    { gate: "full_page_layout", label: "逐页版式" },
    { gate: "target_editor", label: "Word/WPS" },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 p-4">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>本机环境</CardTitle>
                <CardDescription>结果来自本地 Python 文档引擎。</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="重新检查本机环境"
                onClick={onRefresh}
                disabled={environment.status === "loading"}
              >
                {environment.status === "loading" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RefreshCwIcon />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {environment.status === "loading" ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在检查本机环境
              </div>
            ) : null}
            {environment.status === "error" ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>文档引擎未连接</AlertTitle>
                <AlertDescription>{environment.message}</AlertDescription>
              </Alert>
            ) : null}
            {environment.status === "ready" ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">
                    {environment.result.platform.system} · Python{" "}
                    {environment.result.platform.python}
                  </span>
                  <Badge variant={environment.result.ready ? "outline" : "destructive"}>
                    {environment.result.ready ? "基础环境可用" : "需要修复"}
                  </Badge>
                </div>
                <Separator />
                <div className="divide-y">
                  {environment.result.checks.map((check) => (
                    <CheckRow check={check} key={check.id} />
                  ))}
                </div>
                <Button
                  className="mt-3 w-full"
                  variant="outline"
                  onClick={onInstallTemplate}
                  disabled={templateInstalling}
                >
                  {templateInstalling ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <PackageCheckIcon />
                  )}
                  {templateInstalling ? "正在验证模板" : "选择并安装受信任模板"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>文档质量</CardTitle>
            <CardDescription>五类状态独立记录，不合并成一个通过结果。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {qualityChecks.map(({ gate, label }) => {
              const check = checks.find((item) => item.gate === gate)
              const status = check?.status ?? "not_checked"
              const labelText =
                status === "pass"
                  ? "通过"
                  : status === "fail"
                    ? "未通过"
                    : status === "blocked"
                      ? "受阻"
                      : status === "running"
                        ? "检查中"
                        : status === "warn"
                          ? "需注意"
                          : "未检查"
              return (
                <div className="grid gap-1" key={gate}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      {status === "pass" ? (
                        <CheckCircle2Icon className="size-4 text-muted-foreground" />
                      ) : status === "running" ? (
                        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <CircleDashedIcon className="size-4 text-muted-foreground" />
                      )}
                      {label}
                    </div>
                    <Badge
                      variant={
                        status === "fail"
                          ? "destructive"
                          : status === "pass"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {labelText}
                    </Badge>
                  </div>
                  {check ? (
                    <p className="pl-6 text-xs text-muted-foreground">{check.message}</p>
                  ) : null}
                </div>
              )
            })}
          </CardContent>
        </Card>

        {exportState.status === "exporting" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在导出</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>
                {exportState.cancelRequested ? "正在请求取消" : "正在生成并检查"}
                {exportState.formats.map((format) => format.toUpperCase()).join("、")}。
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancelExport}
                disabled={exportState.cancelRequested}
              >
                取消导出
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {exportState.status === "error" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>导出失败</AlertTitle>
            <AlertDescription>{exportState.message}</AlertDescription>
          </Alert>
        ) : null}

        {exportState.status === "succeeded" ? (
          <Card>
            <CardHeader>
              <CardTitle>最近导出</CardTitle>
              <CardDescription>
                模板 {exportState.receipt.template.version} ·{" "}
                {new Date(exportState.receipt.generated_at).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {exportState.receipt.artifacts.map((artifact) => (
                <div className="grid gap-1 text-sm" key={artifact.format}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{artifact.format.toUpperCase()}</span>
                    <Badge variant="outline">已生成</Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{artifact.path}</p>
                  <p className="text-xs text-muted-foreground">
                    SHA-256 {artifact.sha256.slice(0, 12)}…
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>导出历史</CardTitle>
                <CardDescription>产物仅通过受控本地记录重新打开。</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="刷新导出历史"
                onClick={onRefreshHistory}
                disabled={history.status === "loading"}
              >
                {history.status === "loading" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RefreshCwIcon />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {history.status === "loading" && history.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">正在读取导出历史。</p>
            ) : null}
            {history.status === "error" ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>导出历史读取失败</AlertTitle>
                <AlertDescription>{history.message}</AlertDescription>
              </Alert>
            ) : null}
            {history.status === "ready" && history.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前文档还没有导出记录。</p>
            ) : null}
            {history.jobs.map((job) => (
              <div className="grid gap-2 rounded-lg border p-3" key={job.export_id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {job.requested_formats
                      .map((format) => format.toUpperCase())
                      .join("、")}
                  </span>
                  <Badge
                    variant={job.status === "failed" ? "destructive" : "outline"}
                  >
                    {job.status === "completed"
                      ? "已完成"
                      : job.status === "failed"
                        ? "失败"
                        : job.status === "cancelled"
                          ? "已取消"
                          : "处理中"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.completed_at ?? job.created_at).toLocaleString()}
                </p>
                {job.artifacts.map((artifact) => {
                  const targetEditor = artifact.checks.find(
                    (check) => check.gate === "target_editor",
                  )
                  return (
                    <div className="grid gap-2 border-t pt-2" key={artifact.artifact_id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">{artifact.display_name}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenArtifact(artifact.artifact_id)}
                        >
                          <FolderOpenIcon />
                          打开产物
                        </Button>
                      </div>
                      {artifact.format === "docx" ? (
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              targetEditor?.status === "fail" ? "destructive" : "secondary"
                            }
                          >
                            {targetEditor?.status === "pass"
                              ? "Word/WPS 人工验收已记录"
                              : targetEditor?.status === "fail"
                                ? "Word/WPS 人工验收未通过"
                                : "Word/WPS 人工验收未记录"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRecordQa(artifact)}
                          >
                            记录人工验收
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </CardContent>
        </Card>

        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>能力边界</AlertTitle>
          <AlertDescription>
            内容合同、本地导出和自动质量回执已接入；逐页人工检查与 Word/WPS
            验收仍保持独立，必须由使用者明确记录。
          </AlertDescription>
        </Alert>

        <Alert>
          <FolderCheckIcon />
          <AlertTitle>本地数据说明</AlertTitle>
          <AlertDescription>
            草稿保存在本机 SQLite 数据库中；本地存储不等于加密，请妥善保护系统账户。
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  )
}

export default function App() {
  const isMobile = useIsMobile()
  const [draft, setDraft] = useState(emptyDraft)
  const [activePane, setActivePane] = useState<ActivePane>("document")
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [mode, setMode] = useState<WorkspaceMode>("persistent")
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [revision, setRevision] = useState(0)
  const [workspace, setWorkspace] = useState<WorkspaceLoadState>({
    status: "loading",
  })
  const [saveState, setSaveState] = useState<SaveState>("loading")
  const [environment, setEnvironment] = useState<EnvironmentState>({
    status: "loading",
  })
  const [qualityChecks, setQualityChecks] = useState<CheckResult[]>([])
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" })
  const [history, setHistory] = useState<ExportHistoryState>({
    status: "loading",
    jobs: [],
  })
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null)
  const [templateInstalling, setTemplateInstalling] = useState(false)
  const [qaTarget, setQaTarget] = useState<QaTarget | null>(null)
  const [qaNotes, setQaNotes] = useState("")
  const [qaSubmitting, setQaSubmitting] = useState(false)
  const activeDocumentId = document?.id
  const activeDocumentType: DocumentType =
    document?.document_type === "midterm" ? "midterm" : "proposal"
  const editVersion = useRef(0)
  const saving = useRef(false)

  const applyWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, fallback?: Draft) => {
      const api = getDesktopApi()
      if (!api) throw new Error("请在 Electron 桌面应用中运行工作台。")

      let activeDocument = snapshot.document
      if (!activeDocument) {
        const initial = fallback ?? emptyDraft
        activeDocument = await api.createDocument({
          profile_id: snapshot.profile?.id ?? null,
          document_type: "proposal",
          template_version: "0.1.0-dev.1",
          schema_version: "0.2",
          title: initial.title.trim() || "未命名开题报告",
        })
      }

      const resolvedDocument = activeDocument
      setMode(snapshot.mode)
      setProfile(snapshot.profile)
      setDocument(resolvedDocument)
      setDocuments(
        snapshot.documents?.some((item) => item.id === resolvedDocument.id)
          ? snapshot.documents
          : [...(snapshot.documents ?? []), resolvedDocument],
      )
      setRevision(currentRevision(resolvedDocument))
      setDraft(draftFromRecords(snapshot.profile, resolvedDocument, fallback))
      setQualityChecks([])
      setExportState({ status: "idle" })
      setHistory({ status: "loading", jobs: [] })
      setPendingExport(null)
      setQaTarget(null)
      editVersion.current = 0
      setSaveState(fallback ? "dirty" : "saved")
      setWorkspace({ status: "ready" })
    },
    [],
  )

  const openWorkspace = useCallback(
    async (nextMode: WorkspaceMode, fallback?: Draft) => {
      const api = getDesktopApi()
      if (!api) {
        setWorkspace({
          status: "error",
          message: "请在 Electron 桌面应用中运行工作台。",
        })
        setSaveState("error")
        return false
      }

      setWorkspace({ status: "loading" })
      setSaveState("loading")
      try {
        const snapshot = await api.openWorkspace(nextMode)
        await applyWorkspace(snapshot, fallback)
        return true
      } catch (error) {
        setWorkspace({
          status: "error",
          message: error instanceof Error ? error.message : "工作区载入失败。",
        })
        setSaveState("error")
        return false
      }
    },
    [applyWorkspace],
  )

  const refreshEnvironment = useCallback(async () => {
    setEnvironment({ status: "loading" })
    setEnvironment(await loadEnvironmentState())
  }, [])

  const refreshHistory = useCallback(async () => {
    const api = getDesktopApi()
    if (!api || !activeDocumentId) return
    setHistory((current) => ({ status: "loading", jobs: current.jobs }))
    try {
      const result = await api.listExportHistory({ documentId: activeDocumentId, limit: 10 })
      setHistory({ status: "ready", jobs: result.history })
    } catch (error) {
      setHistory((current) => ({
        status: "error",
        jobs: current.jobs,
        message: error instanceof Error ? error.message : "导出历史读取失败。",
      }))
    }
  }, [activeDocumentId])

  useEffect(() => {
    void loadEnvironmentState().then(setEnvironment)
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- initial IPC hydration synchronizes React with the local workspace.
    void openWorkspace("persistent")
  }, [openWorkspace])

  useEffect(() => {
    if (!activeDocumentId) return
    // oxlint-disable-next-line react/set-state-in-effect -- history follows the restored active document.
    void refreshHistory()
  }, [activeDocumentId, refreshHistory])

  const saveNow = useCallback(
    async (reason: "auto" | "manual" = "auto") => {
      const api = getDesktopApi()
      if (!api || !document || workspace.status !== "ready" || saving.current) {
        return false
      }

      const versionAtStart = editVersion.current
      const draftAtStart = draft
      const documentAtStart = document
      const expectedRevision = revision
      saving.current = true
      setSaveState("saving")

      try {
        let savedProfile = profile
        if (profileIsComplete(draftAtStart)) {
          savedProfile = await api.saveProfile(
            profileFromDraft(draftAtStart, profile),
          )
          setProfile(savedProfile)
        }

        const result = await api.saveDraft({
          documentId: documentAtStart.id,
          content: draftToContent(
            draftAtStart,
            documentAtStart.document_type === "midterm" ? "midterm" : "proposal",
          ),
          expectedRevision,
          reason,
        })
        setRevision(result.revision)
        setDocument((current) =>
          current
            ? {
                ...current,
                content: draftToContent(
                  draftAtStart,
                  documentAtStart.document_type === "midterm" ? "midterm" : "proposal",
                ),
                current_revision: result.revision,
                saved_at: result.saved_at,
              }
            : current,
        )
        setSaveState(editVersion.current === versionAtStart ? "saved" : "dirty")
        return true
      } catch (error) {
        setSaveState(errorHasCode(error, "REVISION_CONFLICT") ? "conflict" : "error")
        return false
      } finally {
        saving.current = false
      }
    },
    [document, draft, profile, revision, workspace.status],
  )

  const switchDocumentType = async (documentType: DocumentType) => {
    const api = getDesktopApi()
    if (documentType === activeDocumentType) {
      setActivePane("document")
      return
    }
    if (
      !api ||
      workspace.status !== "ready" ||
      saveState === "saving" ||
      exportState.status === "exporting"
    ) {
      return
    }
    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveNow("manual")
      if (!saved) return
    }

    setWorkspace({ status: "loading" })
    setSaveState("loading")
    try {
      const existing = documents.find(
        (item) => item.document_type === documentType,
      )
      if (existing) {
        const snapshot = await api.selectDocument(existing.id)
        await applyWorkspace(snapshot)
        setActivePane("document")
      } else {
        const created = await api.createDocument({
          profile_id: profile?.id ?? null,
          document_type: documentType,
          template_version:
            documentType === "midterm"
              ? "0.1+local.20260830"
              : "0.1.0-dev.1",
          schema_version: documentType === "midterm" ? "0.1" : "0.2",
          title:
            documentType === "midterm"
              ? "未命名中期检查表"
              : "未命名开题报告",
        })
        setDocument(created)
        setDocuments((current) => [...current, created])
        setRevision(currentRevision(created))
        setDraft(draftFromRecords(profile, created))
        setQualityChecks([])
        setExportState({ status: "idle" })
        setHistory({ status: "loading", jobs: [] })
        setPendingExport(null)
        setQaTarget(null)
        editVersion.current = 0
        setSaveState("saved")
        setWorkspace({ status: "ready" })
        setActivePane("document")
      }
    } catch (error) {
      setWorkspace({
        status: "error",
        message: error instanceof Error ? error.message : "文档切换失败。",
      })
      setSaveState("error")
    }
  }

  useEffect(() => {
    if (saveState !== "dirty" || workspace.status !== "ready") return
    const timeout = window.setTimeout(() => {
      void saveNow("auto")
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [draft, revision, saveNow, saveState, workspace.status])

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setQualityChecks([])
    editVersion.current += 1
    setSaveState("dirty")
  }

  const enterTemporaryMode = async () => {
    if (mode === "temporary") return
    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveNow("manual")
      if (!saved) return
    }
    await openWorkspace("temporary", draft)
  }

  const closeTemporaryMode = async () => {
    const api = getDesktopApi()
    if (
      !api ||
      !document ||
      mode !== "temporary" ||
      saving.current ||
      saveState === "saving"
    )
      return
    setWorkspace({ status: "loading" })
    setSaveState("loading")
    try {
      const snapshot = await api.closeTemporary(document.id)
      await applyWorkspace(snapshot)
      toast.success("临时内容已丢弃，已返回持久工作区。")
    } catch (error) {
      setWorkspace({
        status: "error",
        message: error instanceof Error ? error.message : "临时工作区关闭失败。",
      })
      setSaveState("error")
    }
  }

  const restorePrevious = async () => {
    const api = getDesktopApi()
    if (!api || !document || saveState !== "saved" || revision < 2) return
    setSaveState("saving")
    try {
      const restored = await api.restorePrevious({
        documentId: document.id,
        expectedRevision: revision,
      })
      setDocument(restored)
      setRevision(currentRevision(restored))
      setDraft(draftFromRecords(profile, restored))
      setQualityChecks([])
      editVersion.current += 1
      setSaveState("saved")
      toast.success("已恢复上一版，并保存为新的修订。")
    } catch (error) {
      setSaveState(errorHasCode(error, "REVISION_CONFLICT") ? "conflict" : "error")
    }
  }

  const checkContent = async (): Promise<boolean> => {
    const api = getDesktopApi()
    if (!api || !document || workspace.status !== "ready") return false
    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveNow("manual")
      if (!saved) return false
    }
    const runningCheck: CheckResult = {
      schema_version: "1.0",
      check_id:
        activeDocumentType === "midterm"
          ? "midterm-content"
          : "proposal-content",
      gate: "content",
      status: "running",
      blocking: true,
      message:
        activeDocumentType === "midterm"
          ? "正在检查中期检查表必填字段和结构化内容。"
          : "正在检查开题报告必填字段和段落结构。",
      checked_at: null,
    }
    setQualityChecks([runningCheck])
    try {
      const result = await api.checkDocument(document.id)
      setQualityChecks(result.checks)
      const passed = result.checks.every((check) => check.status === "pass")
      if (passed) toast.success("内容检查通过，可以开始导出。")
      else toast.error(result.checks.find((check) => check.status === "fail")?.message ?? "内容检查未通过。")
      return passed
    } catch (error) {
      const message = error instanceof Error ? error.message : "内容检查失败。"
      setQualityChecks([
        {
          ...runningCheck,
          status: "fail",
          message,
          code: "CHECK_FAILED",
        },
      ])
      toast.error(message)
      return false
    }
  }

  const installTemplate = async () => {
    const api = getDesktopApi()
    if (!api || templateInstalling) return
    setTemplateInstalling(true)
    try {
      const installed = await api.installTemplatePack(activeDocumentType)
      if (!installed) return
      toast.success(`受信任模板 ${installed.version} 已安装。`)
      await refreshEnvironment()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板安装失败。")
    } finally {
      setTemplateInstalling(false)
    }
  }

  const openArtifact = async (artifactId: string) => {
    const api = getDesktopApi()
    if (!api) return
    try {
      const result = await api.openExportArtifact(artifactId)
      if (result.opened) toast.success("已使用系统默认应用打开产物。")
      else toast.error(result.application_error ?? "产物打开失败。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "产物打开失败。")
    }
  }

  const recordQa = async (
    editor: "word" | "wps",
    status: "pass" | "fail",
  ) => {
    const api = getDesktopApi()
    if (!api || !qaTarget || qaSubmitting) return
    setQaSubmitting(true)
    try {
      await api.recordQa({
        artifactId: qaTarget.artifact.artifact_id,
        gate: "target_editor",
        status,
        editor,
        message:
          qaNotes.trim() ||
          (status === "pass" ? "已完成逐页人工验收。" : "人工验收未通过。"),
      })
      setQaTarget(null)
      setQaNotes("")
      toast.success(
        status === "pass"
          ? `${editor === "word" ? "Word" : "WPS"} 人工验收已记录。`
          : `${editor === "word" ? "Word" : "WPS"} 未通过已记录。`,
      )
      await refreshHistory()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "人工验收记录失败。")
    } finally {
      setQaSubmitting(false)
    }
  }

  const executeExport = async (
    pending: PendingExport,
    overwriteConfirmed: boolean,
  ) => {
    const api = getDesktopApi()
    if (!api) return
    setPendingExport(null)
    setExportState({
      status: "exporting",
      formats: pending.formats,
      requestId: pending.requestId,
      cancelRequested: false,
    })
    try {
      const receipt = await api.exportDocument({
        requestId: pending.requestId,
        documentId: pending.documentId,
        outputDirectory: pending.outputDirectory,
        formats: pending.formats,
        overwriteConfirmed,
        preflightToken: pending.preflightToken,
      })
      setQualityChecks(receipt.checks)
      setExportState({ status: "succeeded", receipt })
      toast.success(
        `已导出 ${receipt.artifacts
          .map((artifact) => artifact.format.toUpperCase())
          .join("、")}。`,
      )
      await refreshHistory()
    } catch (error) {
      const cancelled = errorHasCode(error, "EXPORT_CANCELLED")
      const message = cancelled
        ? "导出已取消，未完成的临时产物已清理。"
        : error instanceof Error
          ? error.message
          : "导出失败。"
      setExportState({ status: "error", message })
      if (cancelled) toast.info(message)
      else toast.error(message)
      await refreshHistory()
    }
  }

  const startExport = async (formats: ExportFormat[]) => {
    const api = getDesktopApi()
    if (!api || !document || exportState.status === "exporting") return
    const passed = await checkContent()
    if (!passed) return
    const outputDirectory = await api.chooseExportDirectory()
    if (!outputDirectory) return
    try {
      const preflight = await api.preflightExport({
        documentId: document.id,
        formats,
        outputDirectory,
      })
      const pending: PendingExport = {
        requestId: newRequestId(),
        documentId: document.id,
        outputDirectory,
        formats: preflight.targets.map((target) => target.format),
        preflightToken: preflight.preflight_token,
      }
      if (preflight.overwrite_required) {
        setPendingExport(pending)
        return
      }
      await executeExport(pending, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出预检失败。"
      setExportState({ status: "error", message })
      toast.error(message)
    }
  }

  const cancelExport = async () => {
    const api = getDesktopApi()
    if (!api || exportState.status !== "exporting" || exportState.cancelRequested) return
    const requestId = exportState.requestId
    setExportState((current) =>
      current.status === "exporting"
        ? { ...current, cancelRequested: true }
        : current,
    )
    try {
      const result = await api.cancelExport(requestId)
      if (!result.accepted) {
        toast.info("导出任务已结束，无需取消。")
      }
    } catch (error) {
      setExportState((current) =>
        current.status === "exporting"
          ? { ...current, cancelRequested: false }
          : current,
      )
      toast.error(error instanceof Error ? error.message : "取消导出失败。")
    }
  }

  const saveLabels: Record<SaveState, string> = {
    loading: "正在载入",
    dirty: "未保存",
    saving: "正在保存",
    saved: mode === "temporary" ? "临时内容已保存" : "已保存",
    error: "保存失败",
    conflict: "修订冲突",
  }

  const workspaceDisabled = workspace.status !== "ready"
  const exportDisabled =
    workspaceDisabled ||
    activePane === "profile" ||
    !document ||
    saveState !== "saved" ||
    !draftIsExportReady(draft, activeDocumentType) ||
    exportState.status === "exporting"

  const editor =
    activePane === "profile" ? (
      <StudentProfileEditor
        draft={draft}
        onChange={updateDraft}
        disabled={workspaceDisabled}
        workspace={workspace}
      />
    ) : (
      <DocumentEditor
        documentType={activeDocumentType}
        draft={draft}
        onChange={updateDraft}
        disabled={workspaceDisabled}
        mode={mode}
        workspace={workspace}
        saveState={saveState}
        onRetryLoad={() => void openWorkspace(mode)}
        onRetrySave={() => void saveNow("manual")}
      />
    )

  const inspectionPanel = (
    <InspectionPanel
      environment={environment}
      onRefresh={refreshEnvironment}
      onInstallTemplate={() => void installTemplate()}
      templateInstalling={templateInstalling}
      checks={qualityChecks}
      exportState={exportState}
      onCancelExport={() => void cancelExport()}
      history={history}
      onRefreshHistory={() => void refreshHistory()}
      onOpenArtifact={(artifactId) => void openArtifact(artifactId)}
      onRecordQa={(artifact) => {
        setQaNotes("")
        setQaTarget({ artifact })
      }}
    />
  )

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        profileActive={activePane === "profile"}
        activeDocumentType={activeDocumentType}
        onSelectProfile={() => setActivePane("profile")}
        onSelectDocumentType={(documentType) => void switchDocumentType(documentType)}
        disabled={workspaceDisabled || exportState.status === "exporting"}
      />
      <SidebarInset className="h-svh overflow-hidden">
        <SiteHeader
          title={
            activePane === "profile"
              ? "学生档案"
              : activeDocumentType === "midterm"
                ? isMobile
                  ? "中期检查"
                  : "中期检查工作台"
                : isMobile
                  ? "开题报告"
                  : "开题报告工作台"
          }
          status={
            <>
              <Badge className="hidden sm:inline-flex" variant="secondary">
                本地工作台
              </Badge>
              {mode === "temporary" ? <Badge variant="outline">临时模式</Badge> : null}
              <Badge
                aria-label={`保存状态：${saveLabels[saveState]}`}
                variant={
                  saveState === "error" || saveState === "conflict"
                    ? "destructive"
                    : saveState === "dirty" || saveState === "saving"
                      ? "outline"
                      : "secondary"
                }
              >
                {saveState === "loading" || saveState === "saving" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : saveState === "error" || saveState === "conflict" ? (
                  <TriangleAlertIcon />
                ) : (
                  <SaveIcon />
                )}
                {saveLabels[saveState]}
              </Badge>
            </>
          }
          actions={
            isMobile ? (
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="检查与导出"
                title="检查与导出"
                onClick={() => setInspectionOpen(true)}
              >
                <PanelRightOpenIcon />
              </Button>
            ) : null
          }
        />

        {activePane === "document" ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2 lg:px-6">
            {mode === "temporary" ? (
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      disabled={workspaceDisabled || saveState === "saving"}
                    />
                  }
                >
                  返回持久工作区
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>丢弃临时内容？</DialogTitle>
                    <DialogDescription>
                      当前临时工作区及其修订会被清除，持久工作区内容不会改变。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>
                      继续编辑
                    </DialogClose>
                    <DialogClose
                      render={
                        <Button
                          variant="destructive"
                          disabled={saveState === "saving"}
                        />
                      }
                      onClick={() => void closeTemporaryMode()}
                    >
                      丢弃并返回
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <Button
                variant="outline"
                onClick={() => void enterTemporaryMode()}
                disabled={workspaceDisabled || saveState === "saving"}
              >
                临时模式
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => void restorePrevious()}
              disabled={saveState !== "saved" || revision < 2 || workspaceDisabled}
            >
              <HistoryIcon />
              恢复上一版
            </Button>
            <Button
              variant="outline"
              onClick={() => void checkContent()}
              disabled={
                workspaceDisabled ||
                !document ||
                saveState === "loading" ||
                saveState === "saving" ||
                exportState.status === "exporting"
              }
            >
              <FileCheck2Icon />
              检查内容
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    disabled={exportDisabled}
                    title={
                      draftIsExportReady(draft, activeDocumentType)
                        ? "选择导出格式"
                        : activeDocumentType === "midterm"
                          ? "请先填写全部必填字段、有效目录、主要研究内容和进展情况"
                          : "请先填写全部必填字段，并确保选题意义至少有两个段落"
                    }
                  />
                }
              >
                {exportState.status === "exporting" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <FileClockIcon />
                )}
                {exportState.status === "exporting" ? "正在导出" : "导出"}
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void startExport(["docx"])}>
                  导出 Word
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startExport(["pdf"])}>
                  导出 PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startExport(["tex"])}>
                  导出 LaTeX 源码包
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startExport(["docx", "pdf"])}>
                  同时导出 Word 和 PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
            {isMobile ? (
              <div className="min-h-0 flex-1">{editor}</div>
            ) : (
              <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
                <ResizablePanel defaultSize="68%" minSize="52%">
                  {editor}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="32%" minSize="24%" maxSize="48%">
                  {inspectionPanel}
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </div>
      </SidebarInset>
      <Sheet open={inspectionOpen} onOpenChange={setInspectionOpen}>
        <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>检查与导出</SheetTitle>
            <SheetDescription>
              环境、质量门禁、导出状态和历史记录保持相互独立。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">{isMobile ? inspectionPanel : null}</div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={pendingExport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingExport(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>目标文件已存在</DialogTitle>
            <DialogDescription>
              所选目录中已有同名产物。只有明确确认后才会覆盖这些文件；取消不会修改现有文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingExport(null)}>
              取消导出
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingExport) void executeExport(pendingExport, true)
              }}
            >
              确认覆盖并导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={qaTarget !== null}
        onOpenChange={(open) => {
          if (!open && !qaSubmitting) {
            setQaTarget(null)
            setQaNotes("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录 Word/WPS 人工验收</DialogTitle>
            <DialogDescription>
              请先在对应编辑器中逐页检查。打开文件或自动渲染不会自动标记为通过。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="qa-notes">
              验收备注（可选）
            </label>
            <Textarea
              id="qa-notes"
              value={qaNotes}
              maxLength={1000}
              disabled={qaSubmitting}
              onChange={(event) => setQaNotes(event.target.value)}
            />
          </div>
          <DialogFooter className="sm:grid sm:grid-cols-2">
            <Button
              variant="outline"
              disabled={qaSubmitting}
              onClick={() => void recordQa("word", "fail")}
            >
              Word 未通过
            </Button>
            <Button
              variant="outline"
              disabled={qaSubmitting}
              onClick={() => void recordQa("wps", "fail")}
            >
              WPS 未通过
            </Button>
            <Button
              disabled={qaSubmitting}
              onClick={() => void recordQa("word", "pass")}
            >
              Word 验收通过
            </Button>
            <Button
              disabled={qaSubmitting}
              onClick={() => void recordQa("wps", "pass")}
            >
              WPS 验收通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster />
    </SidebarProvider>
  )
}
