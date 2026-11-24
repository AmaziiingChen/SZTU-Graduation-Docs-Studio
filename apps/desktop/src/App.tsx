import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FormField as Field } from "@/components/workbench/form-field"
import { FieldSet } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { TEACHER_TITLE_OPTIONS } from "@/lib/teacher-title-options"
import { inferStudentNumberAcademics } from "@/lib/student-number-academics"
import { AssessmentDocumentEditor } from "@/components/workbench/assessment-document-editor"
import { assessmentDocumentRegistry, assessmentContent, assessmentGradeError, emptyAssessmentDraft, isAssessmentDocumentType, readAssessmentDraft, type AssessmentDraft } from "@/lib/assessment-documents"
import { defaultDocumentTitle, documentTypeLabels } from "@/lib/document-names"
import { emptyThesisDraft, readThesisDraft, type ThesisDraft } from "@/lib/thesis-draft"
import { celebrateExportSuccess } from "@/lib/export-celebration"
import { useEditableSelection } from "@/hooks/use-editable-selection"
import { flushLocalDrafts } from "@/lib/use-local-draft"
import { readWorkspaceRecovery, writeWorkspaceRecovery, removeWorkspaceRecovery, type WorkspaceRecovery } from "@/lib/workspace-recovery"
import { SaveIcon as SaveIconAnimated } from "@/components/ui/animateicons/save"
import { EllipsisIcon } from "@/components/ui/animateicons/ellipsis"
import { DownloadIcon } from "@/components/ui/download"
import { FolderOpenIcon as FolderOpenIconAnimated } from "@/components/ui/folder-open"
import { FileTextIcon as FileTextIconAnimated } from "@/components/ui/file-text"
import { RefreshCWIcon as RefreshCwIconAnimated } from "@/components/ui/refresh-cw"
import { useActionFeedback } from "@/hooks/use-action-feedback"
import { ActionFeedbackIcon } from "@/components/workbench/action-feedback-icon"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { LinkIcon } from "@/components/ui/link"
import { PlusIcon } from "@/components/ui/plus"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ChevronDownIcon, LoaderCircleIcon, PackageCheckIcon, SaveIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react"
import { ThinkingOrb } from "thinking-orbs"

import { AppSidebar } from "@/components/workbench/app-sidebar"
import { DocumentDateField, parseDocumentDate } from "@/components/workbench/document-date-field"
import { midtermDateIsAllowed, midtermDateRuleForCollege } from "@/lib/midterm-date-rules"
import { AppearanceSettings } from "@/components/workbench/appearance-settings"
import type { CreateDocumentRequest } from "@/components/workbench/nav-documents"
import { DiagnosticSupport } from "@/components/workbench/diagnostic-support"
import { EnvironmentOnboardingDialog } from "@/components/workbench/environment-onboarding-dialog"
import {
  completeEnvironmentOnboarding,
  environmentOnboardingIsComplete,
} from "@/lib/environment-onboarding"
import { ExportHistoryStatusBadge } from "@/components/workbench/export-history-status-badge"
import {
  DocumentSectionNav,
  type DocumentSectionOption,
} from "@/components/workbench/document-section-nav"
import {
  createOutlineEditorItem,
  isFixedThesisDirectoryTitle,
  OutlineEditor,
  type OutlineEditorItem,
  validateOutlineItems,
} from "@/components/workbench/outline-editor"
import {
  DEFAULT_OUTLINE_NUMBERING_STYLE,
  isOutlineNumberingStyle,
  numberOutlineItems,
  type OutlineLevel,
  type OutlineNumberingStyle,
} from "@/lib/outline-numbering"
import {
  StructuredContentEditor,
  type EditorSelectionSnapshot,
  type FigureChapterOption,
} from "@/components/workbench/structured-content-editor"
import { ReferenceImporter } from "@/components/workbench/reference-importer"
import {
  SaveStatusBadge,
  type SaveState,
} from "@/components/workbench/save-status-badge"
import { TaskScheduleEditor } from "@/components/workbench/task-schedule-editor"
import { SiteHeader } from "@/components/workbench/site-header"
import { ToolDirectory } from "@/components/workbench/tool-directory"
import { ThesisToolsWorkbench } from "@/components/workbench/thesis-tools-workbench"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  ACADEMIC_OPTIONS,
  normalizeAcademicClassLabel,
  type AcademicCollegeOption,
} from "@/data/academic-options"
import {
  acknowledgeAutosave,
  autosaveFingerprint,
  createAutosaveVersionState,
  markAutosaveEdited,
  planAutosave,
  reconcileAutosaveFingerprints,
} from "@/lib/autosave-coordinator"
import { formatBibtex } from "@/lib/bibtex"
import { cn } from "@/lib/utils"
import {
  checkNavigationTarget,
  type CheckNavigationTarget,
} from "@/lib/document-navigation"
import {
  markdownToContentBlocks,
  markdownToInlineParagraph,
  markdownToParagraphs,
} from "@/lib/markdown"
import { paragraphInputText } from "@/lib/paragraph"
import {
  thesisToolOptions,
  type ThesisToolId,
} from "@/lib/thesis-tools"
import {
  isParagraphInput,
  isStructuredBodyValue,
  structuredFigureCatalog,
  structuredFigureChapterCounts,
  structuredProcessEquationChapterCounts,
  structuredProcessEquationLabels,
  type FigureNumberingContext,
  type StructuredEditorMode,
  type StructuredFigureCatalogItem,
} from "@/lib/structured-content-editor"
import {
  createTaskScheduleEditorItem,
  type TaskScheduleEditorItem,
  validateTaskScheduleItems,
} from "@/lib/task-schedule"
import { toast } from "sonner"

import type {
  DocumentRecord,
  DocumentListPageState,
  DocumentType,
  EnvironmentCheck,
  EnvironmentResult,
  ExportFormat,
  ExportJobSummary,
  ExportReceipt,
  JsonObject,
  MidtermDatePolicyStatus,
  MidtermDateRule,
  PreviewResult,
  StudentProfile,
  StudentProfileDraft,
  StudentProfileInput,
  StudentProfileSummary,
  SztuDesktopApi,
  TelemetryUsageEvent,
  UpdateStatus,
  WorkspaceMode,
  WorkspaceState as WorkspaceSnapshot,
} from "@/types/desktop-api"
import type { ToolLinkId } from "@/types/desktop-api"
import type {
  ParagraphInput,
  StructuredBodyValue,
} from "@/types/structured-content"

type Draft = {
  assessment: AssessmentDraft
  thesis: ThesisDraft
  title: StructuredBodyValue
  englishTitle: string
  studentName: string
  studentId: string
  major: string
  college: string
  advisor: string
  advisorTitle: string
  graduationCohort: string
  significance: StructuredBodyValue
  researchContent: StructuredBodyValue
  methods: StructuredBodyValue
  steps: StructuredBodyValue
  references: ParagraphInput[]
  referencesBibtex: string
  className: string
  checkDate: string
  directoryNumberingStyle: OutlineNumberingStyle | null
  directory: OutlineEditorItem[]
  mainResearchContent: StructuredBodyValue
  progress: StructuredBodyValue
  midtermEditableHeadings: boolean
  taskBasicContent: StructuredBodyValue
  taskSchedule: TaskScheduleEditorItem[]
  taskRequiredMaterials: StructuredBodyValue
  taskReferences: ParagraphInput[]
  taskReferencesBibtex: string
  taskNature: string
  taskSourceType: string
  taskResearchLevel: string
  taskOtherResearchLevel: string
  taskProjectNumber: string
  taskSelfProposedBy: string
}

type StructuredDraftField =
  | "title"
  | "significance"
  | "researchContent"
  | "methods"
  | "steps"
  | "mainResearchContent"
  | "progress"
  | "taskBasicContent"
  | "taskRequiredMaterials"

type StructuredAssessmentField = "assessmentComments" | "assessmentDivisionOfWork"
type StructuredEditorField = StructuredDraftField | StructuredAssessmentField

type TextDraftField = Exclude<
  keyof Draft,
  | StructuredDraftField
  | "thesis"
  | "assessment"
  | "directory"
  | "taskSchedule"
  | "references"
  | "taskReferences"
  | "midtermEditableHeadings"
>

type ExportState =
  | { status: "idle" }
  | {
      status: "exporting"
      formats: ExportFormat[]
      requestId: string
      cancelRequested: boolean
    }
  | { status: "succeeded"; receipt: ExportReceipt }
  | { status: "error"; message: string; caseId?: string }

type PreviewState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "generating" }
  | { status: "ready"; result: PreviewResult; stale: boolean }
  | { status: "error"; message: string; caseId?: string }

type ExportHistoryState =
  | { status: "loading"; jobs: ExportJobSummary[] }
  | { status: "ready"; jobs: ExportJobSummary[] }
  | { status: "error"; jobs: ExportJobSummary[]; message: string }

type PendingExport = {
  requestId: string
  documentId: string
  documentType: DocumentType
  previewId: string
  editVersion: number
  previewInputSha256: string
  previewTemplateSha256: string
  outputDirectory: string
  formats: ExportFormat[]
  preflightToken: string
}

type WorkspaceLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

type ActivePane = "profile" | "document" | "inspection" | "tools" | "appearance" | "thesis_tools"

type DocumentViewState = {
  scrollTop: number
  selections: Partial<Record<StructuredEditorField, EditorSelectionSnapshot>>
}

class DocumentViewStateStore {
  readonly #views = new Map<string, DocumentViewState>()

  read(key: string): DocumentViewState | undefined {
    return this.#views.get(key)
  }

  update(
    key: string,
    transform: (current: DocumentViewState) => DocumentViewState,
  ): void {
    const current = this.#views.get(key) ?? { scrollTop: 0, selections: {} }
    this.#views.set(key, transform(current))
  }
}

type EnvironmentState =
  | { status: "loading" }
  | { status: "ready"; result: EnvironmentResult }
  | { status: "error"; message: string }

async function loadEnvironmentState(): Promise<EnvironmentState> {
  const api = getDesktopApi()
  if (!api) {
    return {
      status: "error",
      message: "请在桌面应用中打开工作台。",
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
  assessment: emptyAssessmentDraft(),
  thesis: emptyThesisDraft(),
  title: [],
  englishTitle: "",
  studentName: "",
  studentId: "",
  major: "",
  college: "",
  advisor: "",
  advisorTitle: "",
  graduationCohort: "2026届",
  significance: [],
  researchContent: [],
  methods: [],
  steps: [],
  references: [],
  referencesBibtex: "",
  className: "",
  checkDate: "",
  directoryNumberingStyle: null,
  directory: [createOutlineEditorItem()],
  mainResearchContent: [],
  progress: [],
  midtermEditableHeadings: false,
  taskBasicContent: [],
  taskSchedule: [createTaskScheduleEditorItem()],
  taskRequiredMaterials: [],
  taskReferences: [],
  taskReferencesBibtex: "",
  taskNature: "graduation_thesis",
  taskSourceType: "",
  taskResearchLevel: "",
  taskOtherResearchLevel: "",
  taskProjectNumber: "",
  taskSelfProposedBy: "",
}

const proposalStarterParagraphs = {
  researchContent: "本课题研究内容如下：",
  methods: "本课题研究方法、手段如下：",
  steps: "本课题研究步骤如下：",
} as const

const midtermStarterParagraphs = {
  mainResearchContent: "主要研究内容：",
  progress: "毕业论文（设计）工作进展情况（详述）：",
} as const

function newMidtermDraft(): Draft {
  return {
    ...emptyDraft,
    mainResearchContent: [midtermStarterParagraphs.mainResearchContent],
    progress: [midtermStarterParagraphs.progress],
    midtermEditableHeadings: true,
  }
}

function newProposalDraft(): Draft {
  return {
    ...emptyDraft,
    researchContent: [proposalStarterParagraphs.researchContent],
    methods: [proposalStarterParagraphs.methods],
    steps: [proposalStarterParagraphs.steps],
  }
}

const PROFILE_FIELDS = new Set<TextDraftField>([
  "englishTitle",
  "studentName",
  "studentId",
  "college",
  "major",
  "className",
  "advisor",
  "advisorTitle",
  "graduationCohort",
])

const GRADUATION_COHORT_MAX_LENGTH = 20
const THESIS_TITLE_MAX_LENGTH = 80
const PREVIEW_DRAWER_DEFAULT_WIDTH = 512
const PREVIEW_DRAWER_MIN_WIDTH = 384
const PREVIEW_ACCEPTANCE_BOUNDARY_TOAST_ID = "preview-acceptance-boundary"

function showPreviewAcceptanceBoundary(): void {
  toast.info("Word 版式检查", {
    id: PREVIEW_ACCEPTANCE_BOUNDARY_TOAST_ID,
    description:
      "预览与 Word 文件的排版可能存在差异，提交前请使用 Word 或 WPS 检查。",
    duration: 8_000,
  })
}

function getPreviewDrawerMaxWidth(): number {
  if (typeof window === "undefined") return PREVIEW_DRAWER_DEFAULT_WIDTH
  return Math.max(PREVIEW_DRAWER_MIN_WIDTH, Math.floor(window.innerWidth / 2))
}

function clampPreviewDrawerWidth(width: number, maxWidth: number): number {
  return Math.min(Math.max(width, PREVIEW_DRAWER_MIN_WIDTH), maxWidth)
}

function diagnosticCaseId(error: unknown): string | undefined {
  if (error && typeof error === "object" && "details" in error) {
    const id = recordValue(error.details).diagnostic_case_id
    if (typeof id === "string") return id
  }
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

function telemetryErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test((error as { code: string }).code)
  ) {
    return (error as { code: string }).code
  }
  return "UNKNOWN_ERROR"
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

function profileDraftValue(
  profileDraft: StudentProfileDraft | null,
  field: keyof StudentProfileDraft,
  fallback: string,
): string {
  if (
    profileDraft &&
    Object.prototype.hasOwnProperty.call(profileDraft, field)
  ) {
    return textValue(profileDraft[field])
  }
  return fallback
}

function sharedThesisTitleValue(
  profileDraft: StudentProfileDraft | null,
  profile: StudentProfile | null,
  ...fallbacks: unknown[]
): StructuredBodyValue {
  if (
    profileDraft &&
    Object.prototype.hasOwnProperty.call(profileDraft, "thesis_title") &&
    profileDraft.thesis_title !== null
  ) {
    return inlineStructuredBodyValue(profileDraft.thesis_title)
  }
  if (profile?.thesis_title !== null && profile?.thesis_title !== undefined) {
    return inlineStructuredBodyValue(profile.thesis_title)
  }
  return inlineStructuredBodyValue(...fallbacks)
}

function sharedEnglishThesisTitleValue(
  profileDraft: StudentProfileDraft | null,
  profile: StudentProfile | null,
  legacyTitle: unknown,
  fallbackTitle: unknown,
): string {
  if (typeof profileDraft?.thesis_title_en === "string") return profileDraft.thesis_title_en
  if (typeof profile?.thesis_title_en === "string") return profile.thesis_title_en
  return textValue(legacyTitle) || textValue(fallbackTitle)
}

function paragraphInputPlainText(value: unknown): string {
  if (typeof value === "string") return value
  const paragraph = recordValue(value)
  if (!Array.isArray(paragraph.runs)) return ""
  return paragraph.runs
    .map((run) => textValue(recordValue(run).text || recordValue(run).alt))
    .join("")
}

function markdownInlineParagraphValue(value: string): ParagraphInput {
  const paragraph = markdownToInlineParagraph(value)
  return isParagraphInput(paragraph) ? paragraph : value
}

function paragraphInputsValue(...candidates: unknown[]): ParagraphInput[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const paragraphs = candidate.filter(isParagraphInput)
      if (paragraphs.length === candidate.length && paragraphs.length > 0) {
        return structuredClone(paragraphs)
      }
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return markdownToParagraphs(candidate) as unknown as ParagraphInput[]
    }
  }
  return []
}

function inlineStructuredBodyValue(...candidates: unknown[]): StructuredBodyValue {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const paragraph = candidate.find(isParagraphInput)
      if (paragraph !== undefined) return [structuredClone(paragraph)]
    }
    if (isParagraphInput(candidate)) {
      if (typeof candidate === "string" && !candidate.trim()) continue
      return [
        typeof candidate === "string"
          ? (markdownToInlineParagraph(candidate) as unknown as ParagraphInput)
          : structuredClone(candidate),
      ]
    }
  }
  return []
}

function paragraphStructuredBodyValue(
  ...candidates: unknown[]
): StructuredBodyValue {
  return paragraphInputsValue(...candidates)
}

function structuredBodyValue(
  ...candidates: unknown[]
): StructuredBodyValue {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return structuredClone(candidate) as unknown as StructuredBodyValue
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return markdownToContentBlocks(candidate) as unknown as StructuredBodyValue
    }
  }
  return []
}

function structuredBodyHasText(value: StructuredBodyValue): boolean {
  const paragraphHasText = (paragraph: unknown): boolean => {
    if (typeof paragraph === "string") return paragraph.trim().length > 0
    const record = recordValue(paragraph)
    return (
      Array.isArray(record.runs) &&
      record.runs.some((run) => textValue(recordValue(run).text || recordValue(run).alt).trim().length > 0)
    )
  }
  const blockHasText = (block: unknown): boolean => {
    if (paragraphHasText(block)) return true
    const record = recordValue(block)
    if (record.type === "equation") return textValue(record.alt).trim().length > 0
    if (record.type === "image") return textValue(record.path).trim().length > 0
    if (record.type === "data_table" || record.type === "figure_group") return isStructuredBodyValue([block])
    return (
      (record.type === "ordered_list" || record.type === "unordered_list") &&
      Array.isArray(record.items) &&
      record.items.some((item) => {
        const entry = recordValue(item)
        return paragraphHasText(entry.content) || blockHasText(entry.children)
      })
    )
  }
  return value.some(blockHasText)
}

function bodyHasUserTextBeyondStarter(
  value: StructuredBodyValue,
  starter: string,
): boolean {
  const firstIsStarter =
    value.length > 0 &&
    isParagraphInput(value[0]) &&
    paragraphInputPlainText(value[0]).trim() === starter
  return structuredBodyHasText(firstIsStarter ? value.slice(1) : value)
}

function proposalBodyValue(intro: unknown, ...candidates: unknown[]): StructuredBodyValue {
  const body = structuredBodyValue(...candidates)
  if (typeof intro !== "string" || !intro.trim()) return body
  if (
    body.length > 0 &&
    isParagraphInput(body[0]) &&
    paragraphInputPlainText(body[0]).trim() === intro.trim()
  ) {
    return body
  }
  return [intro, ...body]
}

function structuredBodyPlainText(value: StructuredBodyValue): string {
  const blockText = (block: unknown): string => {
    if (isParagraphInput(block)) return paragraphInputPlainText(block)
    const record = recordValue(block)
    if (
      (record.type !== "ordered_list" && record.type !== "unordered_list") ||
      !Array.isArray(record.items)
    ) {
      return ""
    }
    return record.items
      .flatMap((item) => {
        const entry = recordValue(item)
        return [paragraphInputPlainText(entry.content), blockText(entry.children)]
      })
      .filter(Boolean)
      .join("\n")
  }
  return value.map(blockText).filter(Boolean).join("\n")
}

function paragraphBodyIsValid(value: StructuredBodyValue): boolean {
  return value.every(isParagraphInput)
}

type ReferenceRules = {
  maximumEntries: number
  maximumReferenceLength: number
}

const PROPOSAL_REFERENCE_RULES: ReferenceRules = {
  maximumEntries: 50,
  maximumReferenceLength: 1000,
}

const TASK_BOOK_REFERENCE_RULES: ReferenceRules = {
  maximumEntries: 100,
  maximumReferenceLength: 1500,
}

function referenceState(
  source: string,
  legacyReferences: ParagraphInput[],
  rules: ReferenceRules,
) {
  if (!source.trim()) {
    const valid =
      legacyReferences.length > 0 &&
      legacyReferences.length <= rules.maximumEntries &&
      legacyReferences.every(
        (paragraph) =>
          paragraphInputPlainText(paragraph).trim().length > 0 &&
          paragraphInputPlainText(paragraph).length <=
            rules.maximumReferenceLength,
      )
    return {
      sourcePresent: false,
      valid,
      entryCount: legacyReferences.length,
      paragraphs: structuredClone(legacyReferences),
    }
  }

  const result = formatBibtex(source)
  const formatted = result.references
  const valid =
    result.issues.length === 0 &&
    formatted.length > 0 &&
    formatted.length <= rules.maximumEntries &&
    formatted.every(
      (reference) => reference.text.length <= rules.maximumReferenceLength,
    )
  return {
    sourcePresent: true,
    valid,
    entryCount: formatted.length,
    paragraphs: valid
      ? formatted.map((reference) => structuredClone(reference.paragraph))
      : structuredClone(legacyReferences),
  }
}

function cachedReferencesFromBibtex(
  source: string,
  rules: ReferenceRules,
): ParagraphInput[] | null {
  if (!source.trim()) return []
  const state = referenceState(source, [], rules)
  return state.valid ? state.paragraphs : null
}

function bibliographyEditorState(
  source: string,
  legacyReferences: ParagraphInput[],
  rules: ReferenceRules,
): JsonObject | null {
  if (!source.trim()) return null
  const state = referenceState(source, legacyReferences, rules)
  return {
    bibliography: {
      source_format: "bibtex",
      source_text: source,
      parse_status: state.valid ? "valid" : "invalid",
      entry_count: state.entryCount,
    },
  }
}

function structuredBodyJson(value: StructuredBodyValue): JsonObject[] {
  return structuredClone(value) as unknown as JsonObject[]
}

function inlineParagraphFromBody(value: StructuredBodyValue): ParagraphInput {
  const paragraph = value.find(isParagraphInput)
  return paragraph === undefined ? "" : structuredClone(paragraph)
}

function legacyDirectoryItems(value: unknown): OutlineEditorItem[] {
  if (Array.isArray(value)) {
    const items = value
      .map((rawItem, index) => {
        const item = recordValue(rawItem)
        const level =
          typeof item.level === "number" &&
          Number.isInteger(item.level) &&
          item.level >= 1 &&
          item.level <= 4
            ? (item.level as OutlineLevel)
            : 1
        return {
          id: `outline-loaded-${index}`,
          level,
          number: textValue(item.number),
          title: isParagraphInput(item.title)
            ? structuredClone(item.title)
            : "",
        }
      })
      .filter(
        (item) =>
          !isFixedThesisDirectoryTitle(paragraphInputText(item.title)),
      )
    return items.length ? items : [createOutlineEditorItem()]
  }
  if (typeof value !== "string") return [createOutlineEditorItem()]
  const items = value
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const indentation = line.match(/^[\t ]*/)?.[0] ?? ""
      const indentationLevel = Math.min(
        4,
        1 +
          indentation.split("\t").length -
          1 +
          Math.floor(indentation.replace(/\t/g, "").length / 2),
      )
      const trimmed = line.trim()
      const match = /^(\d+(?:\.\d+){0,3})\s+(.+)$/.exec(trimmed)
      const number = match?.[1] ?? ""
      const numberLevel = number ? number.split(".").length : 1
      return {
        id: `outline-legacy-${index}`,
        level: Math.max(indentationLevel, numberLevel) as OutlineLevel,
        number,
        title: markdownInlineParagraphValue((match?.[2] ?? trimmed).trim()),
      }
    })
    .filter(
      (item) => !isFixedThesisDirectoryTitle(paragraphInputText(item.title)),
    )
  return items.length ? items : [createOutlineEditorItem()]
}

function directoryItems(value: OutlineEditorItem[]): JsonObject[] {
  return value.map((item) => ({
    level: item.level,
    ...(item.number.trim() ? { number: item.number.trim() } : {}),
    title: structuredClone(item.title),
  }))
}

function taskScheduleItems(value: unknown): TaskScheduleEditorItem[] {
  if (Array.isArray(value)) {
    const entries = value.map((rawEntry, index) => {
      const entry = recordValue(rawEntry)
      const content = isParagraphInput(entry.content)
        ? structuredClone(entry.content)
        : ""
      return {
        id: `task-schedule-loaded-${index}`,
        period: textValue(entry.period),
        content,
      }
    })
    return entries.length ? entries : [createTaskScheduleEditorItem()]
  }
  if (typeof value !== "string") return [createTaskScheduleEditorItem()]
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = /^([^|｜]+?)[|｜](.+)$/.exec(line)
      return {
        id: `task-schedule-legacy-${index}`,
        period: match?.[1]?.trim() ?? "",
        content: markdownInlineParagraphValue((match?.[2] ?? line).trim()),
      }
    })
  return entries.length ? entries : [createTaskScheduleEditorItem()]
}

function taskScheduleEntries(value: TaskScheduleEditorItem[]): JsonObject[] {
  return value.map((entry) => ({
    period: entry.period.trim(),
    content: structuredClone(entry.content),
  }))
}

function graduationYearFromCohort(value: string): number | null {
  const match = /^(\d{4})(?:届)?$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  return year >= 2000 && year <= 2100 ? year : null
}

function taskTopicInformation(draft: Draft): JsonObject {
  let source: JsonObject = { type: draft.taskSourceType }
  if (draft.taskSourceType === "research_project") {
    const researchProject: JsonObject = {
      level: draft.taskResearchLevel,
      project_number: draft.taskProjectNumber.trim(),
    }
    if (draft.taskResearchLevel === "other") {
      researchProject.other_level = draft.taskOtherResearchLevel.trim()
    }
    source = {
      type: "research_project",
      research_project: researchProject,
    }
  } else if (draft.taskSourceType === "self_proposed") {
    source = {
      type: "self_proposed",
      self_proposed_by: draft.taskSelfProposedBy,
    }
  }
  return {
    nature: draft.taskNature,
    source,
  }
}

function taskTopicIsComplete(draft: Draft): boolean {
  if (
    draft.taskNature !== "graduation_design" &&
    draft.taskNature !== "graduation_thesis"
  ) {
    return false
  }
  if (draft.taskSourceType === "practice_project") return true
  if (draft.taskSourceType === "self_proposed") {
    return ["teacher", "student", "teacher_student_joint"].includes(
      draft.taskSelfProposedBy,
    )
  }
  if (draft.taskSourceType !== "research_project") return false
  if (!draft.taskProjectNumber.trim() || draft.taskProjectNumber.length > 50) {
    return false
  }
  if (
    draft.taskResearchLevel !== "national" &&
    draft.taskResearchLevel !== "provincial_ministerial" &&
    draft.taskResearchLevel !== "other"
  ) {
    return false
  }
  return (
    draft.taskResearchLevel !== "other" ||
    (draft.taskOtherResearchLevel.trim().length > 0 &&
      draft.taskOtherResearchLevel.length <= 50)
  )
}

function documentTypeFromRecord(value: string | undefined): DocumentType {
  if (value === "task_book" || value === "midterm" || value === "thesis" || isAssessmentDocumentType(value)) return value
  return "proposal"
}

const defaultDocumentSections: Record<DocumentType, string> = {
  proposal: "proposal_significance",
  task_book: "task_basic",
  midterm: "document_info",
  thesis: "thesis_template",
  advisor_review: "assessment_info",
  reviewer_review: "assessment_info",
  defense_record: "assessment_info",
  grade_assessment: "assessment_info",
}

function completionState(
  complete: boolean,
  hasValue = complete,
): DocumentSectionOption["state"] {
  if (complete) return "complete"
  return hasValue ? "error" : "incomplete"
}

function documentSectionOptions(
  draft: Draft,
  documentType: DocumentType,
  midtermDateRule?: MidtermDateRule,
 ): DocumentSectionOption[] {
  if (isAssessmentDocumentType(documentType)) {
    const options: DocumentSectionOption[] = [{ id: "assessment_info", label: "基本信息", description: "" }]
    if (documentType === "defense_record") options.push({ id: "assessment_questions", label: "问答记录", description: "" })
    else options.push({ id: "assessment_comments", label: documentType === "grade_assessment" ? "小组意见" : "评审意见", description: "" })
    if (documentType === "advisor_review") options.push({ id: "assessment_division", label: "分工情况", description: "" })
    if (documentType === "advisor_review" || documentType === "reviewer_review") options.push({ id: "assessment_suggested_grade", label: "建议成绩", description: "" })
    if (documentType === "defense_record") options.push({ id: "assessment_members", label: "答辩人员", description: "" })
    if (documentType === "grade_assessment") options.push({ id: "assessment_grade", label: "最终成绩", description: "", ...(assessmentGradeError(draft.assessment.finalGrade) ? { state: "error" as const } : {}) })
    return options
  }
  if (documentType === "thesis") return [
    { id: "thesis_template", label: "LaTeX 模板", description: "下载毕业论文源码工程" },
  ]
  if (documentType === "task_book") {
    const scheduleErrors = validateTaskScheduleItems(draft.taskSchedule)
    const references = referenceState(
      draft.taskReferencesBibtex,
      draft.taskReferences,
      TASK_BOOK_REFERENCE_RULES,
    )
    return [
      {
        id: "task_basic",
        label: "内容要求",
        description: "任务目标、成果和完成标准",
        state: completionState(
          structuredBodyHasText(draft.taskBasicContent),
          structuredBodyHasText(draft.taskBasicContent),
        ),
      },
      {
        id: "task_schedule",
        label: "进度安排",
        description: "时间范围与阶段任务",
        state: completionState(
          scheduleErrors.length === 0,
          draft.taskSchedule.some(
            (entry) =>
              entry.period.trim().length > 0 ||
              paragraphInputText(entry.content).trim().length > 0,
          ),
        ),
      },
      {
        id: "task_materials",
        label: "所需资料",
        description: "需收集的资料，可留空",
        state:
          draft.taskRequiredMaterials.length > 50
            ? "error"
            : structuredBodyHasText(draft.taskRequiredMaterials)
              ? "complete"
              : "optional",
      },
      {
        id: "task_references",
        label: "参考文献",
        description: "任务书使用的参考资料",
        state: completionState(
          references.valid,
          references.sourcePresent || references.entryCount > 0,
        ),
      },
      {
        id: "task_topic",
        label: "选题信息",
        description: "选题性质和课题来源",
        state: completionState(taskTopicIsComplete(draft), Boolean(draft.taskNature)),
      },
    ]
  }
  if (documentType === "midterm") {
    const outlineErrors = validateOutlineItems(draft.directory)
    return [
      {
        id: "document_info",
        label: "检查日期",
        description: "填写本次中期检查日期",
        state: completionState(
          isValidDraftDate(draft.checkDate) && midtermDateIsAllowed(draft.checkDate, midtermDateRule),
          draft.checkDate.trim().length > 0,
        ),
      },
      {
        id: "midterm_directory",
        label: "论文目录",
        description: "一至四级论文目录",
        state: completionState(
          outlineErrors.length === 0,
          draft.directory.some((item) =>
            paragraphInputText(item.title).trim(),
          ),
        ),
      },
      {
        id: "midterm_research",
        label: "研究内容",
        description: "当前论文研究内容",
        state: completionState(
          bodyHasUserTextBeyondStarter(draft.mainResearchContent, midtermStarterParagraphs.mainResearchContent),
          bodyHasUserTextBeyondStarter(draft.mainResearchContent, midtermStarterParagraphs.mainResearchContent),
        ),
      },
      {
        id: "midterm_progress",
        label: "进展情况",
        description: "已完成工作和当前进度",
        state: completionState(
          bodyHasUserTextBeyondStarter(draft.progress, midtermStarterParagraphs.progress),
          bodyHasUserTextBeyondStarter(draft.progress, midtermStarterParagraphs.progress),
        ),
      },
    ]
  }
  return [
    {
      id: "proposal_significance",
      label: "选题意义",
      description: "选题意义及国内外发展状况",
      state: completionState(
        paragraphBodyIsValid(draft.significance) &&
          draft.significance.filter((paragraph) =>
            paragraphInputPlainText(paragraph).trim(),
          ).length >= 2,
        structuredBodyHasText(draft.significance),
      ),
    },
    {
      id: "proposal_research",
      label: "研究内容",
      description: "研究对象、问题和拟完成内容",
      state: completionState(
        bodyHasUserTextBeyondStarter(draft.researchContent, proposalStarterParagraphs.researchContent),
        bodyHasUserTextBeyondStarter(draft.researchContent, proposalStarterParagraphs.researchContent),
      ),
    },
    {
      id: "proposal_methods",
      label: "研究方法",
      description: "研究方法与技术手段",
      state: completionState(
        bodyHasUserTextBeyondStarter(draft.methods, proposalStarterParagraphs.methods),
        bodyHasUserTextBeyondStarter(draft.methods, proposalStarterParagraphs.methods),
      ),
    },
    {
      id: "proposal_steps",
      label: "研究步骤",
      description: "实际推进顺序和阶段安排",
      state: completionState(
        bodyHasUserTextBeyondStarter(draft.steps, proposalStarterParagraphs.steps),
        bodyHasUserTextBeyondStarter(draft.steps, proposalStarterParagraphs.steps),
      ),
    },
    {
      id: "proposal_references",
      label: "参考文献",
      description: "参考文献",
      state: completionState(
        referenceState(
          draft.referencesBibtex,
          draft.references,
          PROPOSAL_REFERENCE_RULES,
        ).valid,
        draft.referencesBibtex.trim().length > 0 || draft.references.length > 0,
      ),
    },
  ]
}

function draftIsExportReady(draft: Draft, documentType: DocumentType, midtermDateRule?: MidtermDateRule): boolean {
  if (isAssessmentDocumentType(documentType)) return assessmentProfileIsComplete(draft) && !!structuredBodyPlainText(draft.title).trim() && structuredBodyPlainText(draft.title).length <= THESIS_TITLE_MAX_LENGTH && (documentType !== "grade_assessment" || !assessmentGradeError(draft.assessment.finalGrade))
  if (documentType === "thesis") return profileIsComplete(draft) &&
    !!structuredBodyPlainText(draft.title).trim() && structuredBodyPlainText(draft.title).length <= THESIS_TITLE_MAX_LENGTH &&
    !!draft.englishTitle.trim() && /^\d{4}-\d{2}-\d{2}$/.test(draft.thesis.submissionDate) && !!draft.thesis.keywordsCn.trim() &&
    !!draft.thesis.keywordsEn.trim() && structuredBodyHasText(draft.thesis.abstractCn) &&
    structuredBodyHasText(draft.thesis.abstractEn) && draft.thesis.chapters.length > 0 &&
    draft.thesis.chapters.every(chapter => !!chapter.title.trim()) &&
    !!draft.thesis.referencesBibtex.trim() && formatBibtex(draft.thesis.referencesBibtex).issues.length === 0
  if (!profileIsComplete(draft)) return false
  const sharedTitle = structuredBodyPlainText(draft.title).trim()
  if (!sharedTitle || sharedTitle.length > THESIS_TITLE_MAX_LENGTH) return false
  if (documentType === "task_book") {
    const scheduleErrors = validateTaskScheduleItems(draft.taskSchedule)
    const basicContent = draft.taskBasicContent
    const requiredMaterials = draft.taskRequiredMaterials
    const references = referenceState(
      draft.taskReferencesBibtex,
      draft.taskReferences,
      TASK_BOOK_REFERENCE_RULES,
    )
    return (
      graduationYearFromCohort(draft.graduationCohort) !== null &&
      structuredBodyHasText(basicContent) &&
      basicContent.length >= 1 &&
      basicContent.length <= 80 &&
      scheduleErrors.length === 0 &&
      requiredMaterials.length <= 50 &&
      references.valid &&
      taskTopicIsComplete(draft)
    )
  }
  if (documentType === "midterm") {
    const directoryErrors = validateOutlineItems(
      draft.directory,
      draft.directoryNumberingStyle,
    )
    return (
      draft.checkDate.trim().length > 0 &&
      isValidDraftDate(draft.checkDate) &&
      midtermDateIsAllowed(draft.checkDate, midtermDateRule) &&
      directoryErrors.length === 0 &&
      bodyHasUserTextBeyondStarter(draft.mainResearchContent, midtermStarterParagraphs.mainResearchContent) &&
      bodyHasUserTextBeyondStarter(draft.progress, midtermStarterParagraphs.progress)
    )
  }
  return (
    paragraphBodyIsValid(draft.significance) &&
    draft.significance.filter((paragraph) =>
      paragraphInputPlainText(paragraph).trim(),
    ).length >= 2 &&
    [draft.researchContent, draft.methods, draft.steps].every(
      structuredBodyHasText,
    ) &&
    referenceState(
      draft.referencesBibtex,
      draft.references,
      PROPOSAL_REFERENCE_RULES,
    ).valid
  )
}

function draftToContent(draft: Draft, documentType: DocumentType): JsonObject {
  if (isAssessmentDocumentType(documentType)) return assessmentContent(draft.assessment, { title: inlineParagraphFromBody(draft.title) as unknown as JsonObject, student_name: draft.studentName, student_id: draft.studentId, college: draft.college, major: draft.major, advisor: draft.advisor, advisor_title: draft.advisorTitle })
  if (documentType === "thesis") return { metadata: { title: inlineParagraphFromBody(draft.title) }, thesis: { ...structuredClone(draft.thesis), englishTitle: draft.englishTitle } } as unknown as JsonObject
  if (documentType === "task_book") {
    const references = referenceState(
      draft.taskReferencesBibtex,
      draft.taskReferences,
      TASK_BOOK_REFERENCE_RULES,
    )
    const editorState = bibliographyEditorState(
      draft.taskReferencesBibtex,
      draft.taskReferences,
      TASK_BOOK_REFERENCE_RULES,
    )
    return {
      ...(editorState ? { editor_state: editorState } : {}),
      metadata: {
        graduation_year:
          graduationYearFromCohort(draft.graduationCohort) ?? 0,
        title: inlineParagraphFromBody(draft.title),
        student_name: draft.studentName,
        student_id: draft.studentId,
        college: draft.college,
        major: draft.major,
        class_name: normalizeAcademicClassLabel(draft.className),
        advisor: advisorDisplayNames(draft),
      },
      sections: {
        basic_content_and_requirements: structuredBodyJson(
          draft.taskBasicContent,
        ),
        schedule: taskScheduleEntries(draft.taskSchedule),
        required_materials: structuredBodyJson(
          draft.taskRequiredMaterials,
        ),
        references: references.paragraphs,
        topic_information: taskTopicInformation(draft),
      },
    }
  }
  if (documentType === "midterm") {
    const directory = draft.directoryNumberingStyle
      ? numberOutlineItems(draft.directory, draft.directoryNumberingStyle)
      : draft.directory
    return {
      metadata: {
        title: inlineParagraphFromBody(draft.title),
        student_name: draft.studentName,
        college: draft.college,
        major: draft.major,
        class_name: normalizeAcademicClassLabel(draft.className),
        advisor: advisorDisplayNames(draft),
        check_date: draft.checkDate,
      },
      sections: {
        editable_headings: draft.midtermEditableHeadings,
        ...(draft.directoryNumberingStyle
          ? { numbering_style: draft.directoryNumberingStyle }
          : {}),
        directory: directoryItems(directory),
        main_research_content: structuredBodyJson(draft.mainResearchContent),
        progress: structuredBodyJson(draft.progress),
      },
    }
  }
  const references = referenceState(
    draft.referencesBibtex,
    draft.references,
    PROPOSAL_REFERENCE_RULES,
  )
  const editorState = bibliographyEditorState(
    draft.referencesBibtex,
    draft.references,
    PROPOSAL_REFERENCE_RULES,
  )
  return {
    ...(editorState ? { editor_state: editorState } : {}),
    metadata: {
      title: inlineParagraphFromBody(draft.title),
      student_name: draft.studentName,
      student_id: draft.studentId,
      major: draft.major,
      college: draft.college,
      advisor: advisorDisplayNames(draft),
    },
    sections: {
      significance_and_status: structuredBodyJson(draft.significance),
      research_content: structuredBodyJson(draft.researchContent),
      methods_and_means: structuredBodyJson(draft.methods),
      research_steps: structuredBodyJson(draft.steps),
      references: references.paragraphs,
    },
  }
}

function draftFromRecords(
  profile: StudentProfile | null,
  profileDraft: StudentProfileDraft | null,
  document: DocumentRecord | null,
  fallback?: Draft,
): Draft {
  const content = recordValue(document?.content)
  const documentType = documentTypeFromRecord(document?.document_type)
  const metadata = recordValue(content.metadata)
  const sections = recordValue(content.sections)
  const editorState = recordValue(content.editor_state)
  const bibliography = recordValue(editorState.bibliography)
  const topicInformation = recordValue(sections.topic_information)
  const topicSource = recordValue(topicInformation.source)
  const researchProject = recordValue(topicSource.research_project)
  const metadataGraduationYear =
    typeof metadata.graduation_year === "number" &&
    Number.isInteger(metadata.graduation_year) &&
    metadata.graduation_year >= 2000 &&
    metadata.graduation_year <= 2100
      ? `${metadata.graduation_year}届`
      : ""
  const legacyContent = isDraft(document?.content) ? document.content : {}
  const thesis = documentType === "thesis" ? readThesisDraft(content.thesis) : emptyThesisDraft()
  return {
    ...emptyDraft,
    ...fallback,
    ...legacyContent,
    assessment: readAssessmentDraft(metadata, sections, isAssessmentDocumentType(documentType) ? documentType : undefined),
    thesis,
    title: sharedThesisTitleValue(
      profileDraft,
      profile,
      metadata.title,
      legacyContent.title,
      fallback?.title,
    ),
    englishTitle: sharedEnglishThesisTitleValue(profileDraft, profile, thesis.englishTitle, fallback?.englishTitle),
    studentName: profileDraftValue(
      profileDraft,
      "full_name",
      profile?.full_name ||
        textValue(metadata.student_name) ||
        legacyContent.studentName ||
        fallback?.studentName ||
        "",
    ),
    studentId: profileDraftValue(
      profileDraft,
      "student_number",
      profile?.student_number ||
        textValue(metadata.student_id) ||
        legacyContent.studentId ||
        fallback?.studentId ||
        "",
    ),
    college: profileDraftValue(
      profileDraft,
      "college",
      profile?.college ||
        textValue(metadata.college) ||
        legacyContent.college ||
        fallback?.college ||
        "",
    ),
    major: profileDraftValue(
      profileDraft,
      "major",
      profile?.major ||
        textValue(metadata.major) ||
        legacyContent.major ||
        fallback?.major ||
        "",
    ),
    advisor: profileDraftValue(
      profileDraft,
      "advisor_name",
      profile?.advisor_name ||
        textValue(metadata.advisor) ||
        legacyContent.advisor ||
        fallback?.advisor ||
        "",
    ),
    advisorTitle: profileDraftValue(
      profileDraft,
      "advisor_title",
      profile?.advisor_title ||
        textValue(metadata.advisor_title) ||
        legacyContent.advisorTitle ||
        fallback?.advisorTitle ||
        "",
    ),
    graduationCohort: profileDraftValue(
      profileDraft,
      "graduation_cohort",
      profile?.graduation_cohort ||
        metadataGraduationYear ||
        legacyContent.graduationCohort ||
        fallback?.graduationCohort ||
        "2026届",
    ),
    significance: paragraphStructuredBodyValue(
      sections.significance_and_status,
      legacyContent.significance,
      fallback?.significance,
    ),
    researchContent: proposalBodyValue(
      sections.research_content_intro ?? recordValue(legacyContent).researchContentIntro,
      sections.research_content,
      legacyContent.researchContent,
      fallback?.researchContent,
    ),
    methods: proposalBodyValue(
      sections.methods_and_means_intro ?? recordValue(legacyContent).methodsIntro,
      sections.methods_and_means,
      legacyContent.methods,
      fallback?.methods,
    ),
    steps: proposalBodyValue(
      sections.research_steps_intro ?? recordValue(legacyContent).stepsIntro,
      sections.research_steps,
      legacyContent.steps,
      fallback?.steps,
    ),
    references: paragraphInputsValue(
      sections.references,
      legacyContent.references,
      fallback?.references,
    ),
    referencesBibtex:
      documentType === "proposal"
        ? textValue(bibliography.source_text) ||
          legacyContent.referencesBibtex ||
          fallback?.referencesBibtex ||
          ""
        : "",
    className: normalizeAcademicClassLabel(
      profileDraftValue(
        profileDraft,
        "class_name",
        profile?.class_name ||
          textValue(metadata.class_name) ||
          legacyContent.className ||
          fallback?.className ||
          "",
      ),
    ),
    checkDate:
      textValue(metadata.check_date) ||
      legacyContent.checkDate ||
      fallback?.checkDate ||
      "",
    directoryNumberingStyle: isOutlineNumberingStyle(
      sections.numbering_style,
    )
      ? sections.numbering_style
      : isOutlineNumberingStyle(legacyContent.directoryNumberingStyle)
        ? legacyContent.directoryNumberingStyle
        : Array.isArray(sections.directory) || legacyContent.directory
          ? null
          : fallback?.directoryNumberingStyle ??
            DEFAULT_OUTLINE_NUMBERING_STYLE,
    directory: Array.isArray(sections.directory)
      ? legacyDirectoryItems(sections.directory)
      : legacyDirectoryItems(legacyContent.directory ?? fallback?.directory),
    mainResearchContent: documentType === "midterm" && sections.editable_headings !== true
      ? proposalBodyValue(
          midtermStarterParagraphs.mainResearchContent,
          sections.main_research_content,
          legacyContent.mainResearchContent,
          fallback?.mainResearchContent,
        )
      : structuredBodyValue(
          sections.main_research_content,
          legacyContent.mainResearchContent,
          fallback?.mainResearchContent,
        ),
    progress: documentType === "midterm" && sections.editable_headings !== true
      ? proposalBodyValue(
          midtermStarterParagraphs.progress,
          sections.progress,
          legacyContent.progress,
          fallback?.progress,
        )
      : structuredBodyValue(
          sections.progress,
          legacyContent.progress,
          fallback?.progress,
        ),
    midtermEditableHeadings: documentType === "midterm",
    taskBasicContent: structuredBodyValue(
      sections.basic_content_and_requirements,
      legacyContent.taskBasicContent,
      fallback?.taskBasicContent,
    ),
    taskSchedule: taskScheduleItems(
      Array.isArray(sections.schedule)
        ? sections.schedule
        : legacyContent.taskSchedule ?? fallback?.taskSchedule,
    ),
    taskRequiredMaterials: structuredBodyValue(
      sections.required_materials,
      legacyContent.taskRequiredMaterials,
      fallback?.taskRequiredMaterials,
    ),
    taskReferences: paragraphInputsValue(
      sections.references,
      legacyContent.taskReferences,
      fallback?.taskReferences,
    ),
    taskReferencesBibtex:
      documentType === "task_book"
        ? textValue(bibliography.source_text) ||
          legacyContent.taskReferencesBibtex ||
          fallback?.taskReferencesBibtex ||
          ""
        : "",
    taskNature:
      textValue(topicInformation.nature) ||
      legacyContent.taskNature ||
      fallback?.taskNature ||
      "graduation_thesis",
    taskSourceType:
      textValue(topicSource.type) ||
      legacyContent.taskSourceType ||
      fallback?.taskSourceType ||
      "",
    taskResearchLevel:
      textValue(researchProject.level) ||
      legacyContent.taskResearchLevel ||
      fallback?.taskResearchLevel ||
      "",
    taskOtherResearchLevel:
      textValue(researchProject.other_level) ||
      legacyContent.taskOtherResearchLevel ||
      fallback?.taskOtherResearchLevel ||
      "",
    taskProjectNumber:
      textValue(researchProject.project_number) ||
      legacyContent.taskProjectNumber ||
      fallback?.taskProjectNumber ||
      "",
    taskSelfProposedBy:
      textValue(topicSource.self_proposed_by) ||
      legacyContent.taskSelfProposedBy ||
      fallback?.taskSelfProposedBy ||
      "",
  }
}

function currentRevision(document: DocumentRecord): number {
  return document.current_revision
}

function assessmentProfileIsComplete(draft: Draft): boolean {
  return [draft.studentName, draft.studentId, draft.college, draft.major].every(value => value.trim().length > 0)
}

function profileIsComplete(draft: Draft): boolean {
  const requiredFieldsComplete = [
    draft.studentName,
    draft.studentId,
    draft.college,
    draft.major,
    draft.className,
    draft.graduationCohort,
  ].every((value) => value.trim().length > 0)
  return (
    requiredFieldsComplete &&
    advisorEntriesFromDraft(draft).every(
      (entry) => entry.name.trim().length > 0 && entry.title.trim().length > 0,
    ) &&
    draft.graduationCohort.length <= GRADUATION_COHORT_MAX_LENGTH
  )
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
    class_name: normalizeAcademicClassLabel(draft.className),
    advisor_name: advisorEntriesFromDraft(draft)
      .map((entry) => entry.name.trim())
      .join(ADVISOR_SEPARATOR),
    advisor_title: advisorEntriesFromDraft(draft)
      .map((entry) => entry.title.trim())
      .join(ADVISOR_SEPARATOR),
    graduation_cohort: normalizeGraduationCohort(draft.graduationCohort),
    thesis_title: structuredClone(draft.title),
    thesis_title_en: draft.englishTitle,
  }
}

function profileDraftFromDraft(draft: Draft): StudentProfileDraft {
  return {
    full_name: draft.studentName,
    student_number: draft.studentId,
    college: draft.college,
    major: draft.major,
    class_name: normalizeAcademicClassLabel(draft.className),
    advisor_name: draft.advisor,
    advisor_title: draft.advisorTitle,
    graduation_cohort: draft.graduationCohort,
    thesis_title: structuredClone(draft.title),
    thesis_title_en: draft.englishTitle,
  }
}

function autosaveFingerprintsForDraft(
  draft: Draft,
  documentType: DocumentType,
) {
  return {
    profile: autosaveFingerprint(profileDraftFromDraft(draft)),
    document: autosaveFingerprint(draftToContent(draft, documentType)),
  }
}

function normalizeGraduationCohort(value: string): string {
  const cohort = value.trim()
  if (!cohort) return "2026届"
  return /^\d{4}$/.test(cohort) ? `${cohort}届` : cohort
}

function isValidDraftDate(value: string): boolean {
  return parseDocumentDate(value) !== undefined
}

function StructuredBodyField<TField extends string>({
  id,
  label,
  value,
  guidance,
  onChange,
  description,
  error,
  disabled,
  mode = "body",
  selectionSnapshot,
  onSelectionChange,
  fillHeight = false,
  enableFigures = false,
  enableDocumentTools = false,
  enableProcessEquations = false,
  figureChapters,
  figureCatalog,
  figureNumbering,
  startOnNewParagraph = false,
  toolbarActions,
  footerStatus,
}: {
  id: TField
  label: string
  value: StructuredBodyValue
  guidance?: ParagraphInput | null
  onChange: (field: TField, value: StructuredBodyValue, guidance?: ParagraphInput | null) => void
  description: string
  error?: string
  disabled?: boolean
  mode?: StructuredEditorMode
  selectionSnapshot?: EditorSelectionSnapshot
  onSelectionChange?: (selection: EditorSelectionSnapshot) => void
  fillHeight?: boolean
  enableFigures?: boolean
  enableDocumentTools?: boolean
  enableProcessEquations?: boolean
  figureChapters?: FigureChapterOption[]
  figureCatalog?: StructuredFigureCatalogItem[]
  figureNumbering?: FigureNumberingContext
  startOnNewParagraph?: boolean
  toolbarActions?: ReactNode
  footerStatus?: ReactNode
}) {
  const describedBy = error ? `${id}-description ${id}-error` : `${id}-description`
  const editorSupported =
    isStructuredBodyValue(value) &&
    (mode === "body" || paragraphBodyIsValid(value)) &&
    (mode !== "inline" || value.length <= 1)
  return (
    <div className={cn(fillHeight ? "flex h-full min-h-0 flex-col gap-2" : "grid gap-2")}>
      <p className="sr-only" id={`${id}-label`}>
        {label}
      </p>
      <p className="sr-only" id={`${id}-description`}>
        {description}
      </p>
      {editorSupported ? (
        <StructuredContentEditor
          key={`${id}-${mode}`}
          value={value}
          guidance={guidance}
          onChange={(nextValue, nextGuidance) => onChange(id, nextValue, nextGuidance)}
          disabled={disabled}
          ariaLabel={label}
          ariaDescribedBy={describedBy}
          ariaInvalid={Boolean(error)}
          footerMessage={fillHeight ? error : undefined}
          footerMessageId={fillHeight && error ? `${id}-error` : undefined}
          footerStatus={footerStatus}
          placeholder={`输入${label}`}
          mode={mode}
          selectionSnapshot={selectionSnapshot}
          onSelectionChange={onSelectionChange}
          fillHeight={fillHeight}
          enableFigures={enableFigures}
          enableDocumentTools={enableDocumentTools}
          enableProcessEquations={enableProcessEquations}
          figureChapters={figureChapters}
          figureCatalog={figureCatalog}
          figureNumbering={figureNumbering}
          startOnNewParagraph={startOnNewParagraph}
          toolbarActions={toolbarActions}
          className={fillHeight ? "min-h-0 flex-1" : undefined}
        />
      ) : (
        <>
          {toolbarActions ? (
            <div data-slot="document-action-bar" className="flex h-(--header-height) shrink-0 items-center justify-end gap-2 border-b bg-background px-4">
              {toolbarActions}
            </div>
          ) : null}
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>当前内容暂不支持编辑</AlertTitle>
            <AlertDescription>
              当前内容包含不支持编辑的图片或其他结构，原内容将保留，支持保存、预览和导出。
            </AlertDescription>
          </Alert>
        </>
      )}
      {error && (!editorSupported || !fillHeight) ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {!editorSupported && fillHeight && footerStatus ? (
        <div className="mt-auto flex min-h-8 items-center justify-end px-3 py-1">
          {footerStatus}
        </div>
      ) : null}
    </div>
  )
}

const ADVISOR_SEPARATOR = "、"

type AdvisorEntry = {
  name: string
  title: string
}

function advisorValues(value: string): string[] {
  return value === "" ? [""] : value.split(ADVISOR_SEPARATOR)
}

function advisorEntriesFromDraft(draft: Pick<Draft, "advisor" | "advisorTitle">) {
  const names = advisorValues(draft.advisor)
  const titles = advisorValues(draft.advisorTitle)
  const length = Math.max(names.length, titles.length, 1)
  return Array.from({ length }, (_, index): AdvisorEntry => ({
    name: names[index] ?? "",
    title: titles[index] ?? "",
  }))
}

function advisorFieldValue(
  entries: AdvisorEntry[],
  field: keyof AdvisorEntry,
): string {
  return entries.map((entry) => entry[field]).join(ADVISOR_SEPARATOR)
}

function advisorDisplayNames(draft: Pick<Draft, "advisor" | "advisorTitle">) {
  return advisorEntriesFromDraft(draft)
    .map((entry) => entry.name.trim())
    .filter(Boolean)
    .join(ADVISOR_SEPARATOR)
}
const GRADUATION_COHORT_OPTIONS = [
  "2025届",
  "2026届",
  "2027届",
  "2028届",
] as const
const TASK_NATURE_OPTIONS = [
  { value: "graduation_thesis", label: "毕业论文" },
  { value: "graduation_design", label: "毕业设计" },
] as const
const TASK_SOURCE_TYPE_OPTIONS = [
  { value: "research_project", label: "科研项目" },
  { value: "practice_project", label: "实践项目" },
  { value: "self_proposed", label: "自拟题目" },
] as const
const TASK_RESEARCH_LEVEL_OPTIONS = [
  { value: "national", label: "国家级" },
  { value: "provincial_ministerial", label: "省部级" },
  { value: "other", label: "其他" },
] as const
const TASK_SELF_PROPOSED_BY_OPTIONS = [
  { value: "teacher", label: "教师自拟" },
  { value: "student", label: "学生自拟" },
  { value: "teacher_student_joint", label: "师生共拟" },
] as const

function findCollegeOption(value: string): AcademicCollegeOption | undefined {
  const college = value.trim()
  return ACADEMIC_OPTIONS.find((option) => option.college === college)
}

function StudentProfileEditor({
  assessmentMode,
  validationRequested,
  draft,
  onChange,
  onStructuredBodyChange,
  disabled,
  workspace,
  unassigned,
  unassignedHelp,
  profileActions,
}: {
  assessmentMode: boolean
  unassigned: boolean
  unassignedHelp: string
  profileActions: ReactNode
  validationRequested: boolean
  draft: Draft
  onChange: (field: TextDraftField, value: string) => void
  onStructuredBodyChange: (
    field: StructuredDraftField,
    value: StructuredBodyValue,
  ) => void
  disabled: boolean
  workspace: WorkspaceLoadState
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const visibleError = (field: string, error: string | undefined) =>
    validationRequested || touched[field] ? error : undefined
  const complete = assessmentMode ? assessmentProfileIsComplete(draft) : profileIsComplete(draft)
  const selectedCollege = findCollegeOption(draft.college)
  const selectedMajor = selectedCollege?.majors.find(
    (option) => option.major === draft.major.trim(),
  )
  const collegeSuggestions = ACADEMIC_OPTIONS.map((option) => option.college)
  const majorSuggestions = selectedCollege?.majors.map((option) => option.major) ?? []
  const classSuggestions = selectedMajor?.classes ?? []
  const advisorEntries = advisorEntriesFromDraft(draft)
  const titleError = visibleError("title", !structuredBodyPlainText(draft.title).trim()
    ? "请输入中文论文题目。"
    : structuredBodyPlainText(draft.title).length > THESIS_TITLE_MAX_LENGTH
      ? `论文题目最多 ${THESIS_TITLE_MAX_LENGTH} 个字符。`
      : undefined)

  const commitAdvisorEntries = (entries: AdvisorEntry[]) => {
    onChange("advisor", advisorFieldValue(entries, "name"))
    onChange("advisorTitle", advisorFieldValue(entries, "title"))
  }

  const updateAdvisorEntry = (
    index: number,
    field: keyof AdvisorEntry,
    value: string,
  ) => {
    commitAdvisorEntries(
      advisorEntries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    )
  }

  const addAdvisorEntry = () => {
    commitAdvisorEntries([...advisorEntries, { name: "", title: "" }])
  }

  const removeLastAdvisorEntry = () => {
    if (advisorEntries.length <= 1) return
    commitAdvisorEntries(advisorEntries.slice(0, -1))
  }

  const changeCollege = (_field: TextDraftField, value: string) => {
    onChange("college", value)
    if (value.trim() === draft.college.trim()) return
    const nextCollege = findCollegeOption(value)
    if (!nextCollege) {
      if (draft.major) onChange("major", "")
      if (draft.className) onChange("className", "")
      return
    }
    const nextMajor = nextCollege.majors.find(
      (option) => option.major === draft.major.trim(),
    )
    if (!nextMajor) {
      if (draft.major) onChange("major", "")
      if (draft.className) onChange("className", "")
      return
    }
    if (draft.className && !nextMajor.classes.includes(draft.className.trim())) {
      onChange("className", "")
    }
  }

  const changeMajor = (_field: TextDraftField, value: string) => {
    onChange("major", value)
    if (value.trim() === draft.major.trim()) return
    const nextMajor = findCollegeOption(draft.college)?.majors.find(
      (option) => option.major === value.trim(),
    )
    if (
      draft.className &&
      (!nextMajor || !nextMajor.classes.includes(draft.className.trim()))
    ) {
      onChange("className", "")
    }
  }

  if (unassigned) {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto grid max-w-4xl gap-6 p-6">
          {profileActions}
          <Alert>
            <AlertDescription>{unassignedHelp}</AlertDescription>
          </Alert>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div
        className="mx-auto grid max-w-4xl gap-6 p-6"
        onBlurCapture={(event) => {
          const field = event.target.closest<HTMLElement>("[data-profile-field]")?.dataset.profileField ?? event.target.id
          if (field) setTouched((current) => current[field] ? current : { ...current, [field]: true })
        }}
      >
        {profileActions}
        {workspace.status === "loading" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在载入基本信息</AlertTitle>
            <AlertDescription>正在恢复本机保存的基础信息。</AlertDescription>
          </Alert>
        ) : null}

        {validationRequested && !complete && workspace.status === "ready" ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>请先补全基本信息</AlertTitle>
            <AlertDescription>
              {assessmentMode ? "当前评审表需要姓名、学号、学院、专业和论文题目。" : "开题报告、任务书和中期检查需要完整的基本信息，包括毕业届别、班级、指导教师和职称；评审表只需要姓名、学号、学院、专业和论文题目。"}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium">论文题目</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2" data-profile-field="title">
              <StructuredContentEditor
                value={draft.title}
                onChange={(value) => onStructuredBodyChange("title", value)}
                disabled={disabled}
                ariaLabel="中文题目"
                ariaDescribedBy={titleError ? "title-error" : undefined}
                ariaInvalid={Boolean(titleError)}
                placeholder="输入论文题目"
                mode="inline"
                className="[&_[data-slot=editor-format-toolbar]]:h-8 [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:py-2"
              />
              {titleError ? (
                <p className="mt-2 text-xs text-destructive" id="title-error">
                  {titleError}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="studentName"
                label="学生姓名"
                value={draft.studentName}
                error={visibleError("studentName", !draft.studentName.trim() ? "请输入学生姓名。" : undefined)}
                onChange={onChange}
                disabled={disabled}
              />
              <Field
                id="studentId"
                label="学号"
                value={draft.studentId}
                error={visibleError("studentId", !draft.studentId.trim() ? "请输入学号。" : undefined)}
                onChange={onChange}
                disabled={disabled}
              />
              <Field
                id="college"
                label="学院"
                value={draft.college}
                suggestions={collegeSuggestions}
                error={visibleError("college", !draft.college.trim() ? "请输入学院。" : undefined)}
                onChange={changeCollege}
                disabled={disabled}
              />
              <Field
                id="major"
                label="专业"
                value={draft.major}
                suggestions={majorSuggestions}
                error={visibleError("major", !draft.major.trim() ? "请输入专业。" : undefined)}
                onChange={changeMajor}
                disabled={disabled}
              />
              <Field
                id="graduationCohort"
                label="毕业届别"
                value={draft.graduationCohort}
                placeholder="例如：2026届"
                suggestions={GRADUATION_COHORT_OPTIONS}
                maxLength={GRADUATION_COHORT_MAX_LENGTH}
                error={visibleError("graduationCohort",
                  !draft.graduationCohort.trim()
                    ? assessmentMode ? undefined : "请输入毕业届别。"
                    : draft.graduationCohort.length >
                        GRADUATION_COHORT_MAX_LENGTH
                      ? "毕业届别最多 20 个字符。"
                      : undefined
                )}
                onChange={onChange}
                disabled={disabled}
              />
              <Field
                id="className"
                label="班级"
                value={draft.className}
                suggestions={classSuggestions}
                error={visibleError("className", !assessmentMode && !draft.className.trim() ? "请输入班级。" : undefined)}
                onChange={onChange}
                disabled={disabled}
              />
            </div>
            <Separator />
            <FieldSet aria-label="指导信息">
              <div className="grid gap-4 md:grid-cols-2">
                {advisorEntries.map((entry, index) => (
                  <Fragment key={index}>
                    <Field
                      id={`advisor-${index}`}
                      label={index === 0 ? "指导教师" : `第${index + 1}指导教师`}
                      value={entry.name}
                      placeholder="只填写姓名，不填写职称"
                      maxLength={30}
                      error={visibleError(`advisor-${index}`, !assessmentMode && !entry.name.trim() ? "请输入指导教师姓名。" : undefined)}
                      onChange={(_field, nextValue) => updateAdvisorEntry(index, "name", nextValue)}
                      disabled={disabled}
                    />
                    <Field
                      id={`advisor-title-${index}`}
                      label={index === 0 ? "指导教师职称" : `第${index + 1}指导教师职称`}
                      value={entry.title}
                      placeholder="选择或输入职称"
                      suggestions={TEACHER_TITLE_OPTIONS}
                      maxLength={30}
                      error={visibleError(`advisor-title-${index}`, !assessmentMode && !entry.title.trim() ? "请输入指导教师职称。" : undefined)}
                      onChange={(_field, nextValue) => updateAdvisorEntry(index, "title", nextValue)}
                      disabled={disabled}
                    />
                  </Fragment>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={addAdvisorEntry}
                >
                  <AnimatedActionIcon icon={PlusIcon} />
                  添加指导教师
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || advisorEntries.length <= 1}
                  onClick={removeLastAdvisorEntry}
                >
                  <AnimatedActionIcon icon={DeleteIcon} />
                  删除指导教师
                </Button>
              </div>
            </FieldSet>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}

function SaveStatusFooter({ state }: { state: SaveState }) {
  return (
    <div data-slot="save-status-footer" className="flex min-h-8 shrink-0 items-center justify-end px-3 py-1">
      <SaveStatusBadge state={state} quiet />
    </div>
  )
}

function DocumentEditor({
  documentId,
  documentType,
  activeSection,
  viewState,
  onViewStateChange,
  draft,
  midtermDateRule,
  onChange,
  onStructuredBodyChange,
  onDirectoryChange,
  onDirectoryNumberingStyleChange,
  onTaskScheduleChange,
  onAssessmentChange,
  disabled,
  workspace,
  saveState,
  onRetryLoad,
  retryLoadDisabled,
  onRetrySave,
  recoveryAvailable,
  recoveryRestored,
  onRestoreRecovery,
  onDismissRecovery,
  toolbarActions,
  needsDocumentProfile,
  validationRequested,
}: {
  documentId: string
  documentType: DocumentType
  activeSection: string
  viewState: DocumentViewState
  onViewStateChange: (
    update: (current: DocumentViewState) => DocumentViewState,
  ) => void
  draft: Draft
  midtermDateRule?: MidtermDateRule
  onChange: (field: TextDraftField, value: string) => void
  onStructuredBodyChange: (
    field: StructuredDraftField,
    value: StructuredBodyValue,
  ) => void
  onDirectoryChange: (value: OutlineEditorItem[]) => void
  onDirectoryNumberingStyleChange: (value: OutlineNumberingStyle) => void
  onTaskScheduleChange: (value: TaskScheduleEditorItem[]) => void
  onAssessmentChange: (value: AssessmentDraft) => void
  disabled: boolean
  workspace: WorkspaceLoadState
  saveState: SaveState
  onRetryLoad: () => void
  retryLoadDisabled: boolean
  onRetrySave: () => void
  recoveryAvailable: boolean
  recoveryRestored: boolean
  onRestoreRecovery: () => void
  onDismissRecovery: () => void
  toolbarActions?: ReactNode
  needsDocumentProfile: boolean
  validationRequested: boolean
}) {
  const isAssessment = isAssessmentDocumentType(documentType)
  const isMidterm = documentType === "midterm"
  const isTaskBook = documentType === "task_book"
  const isThesis = documentType === "thesis"
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const [templateDownloading, setTemplateDownloading] = useState(false)
  const templateDownloadInFlight = useRef(false)
  const downloadTemplate = async () => {
    if (templateDownloadInFlight.current) return
    const api = getDesktopApi()
    if (!api?.downloadThesisTemplate) {
      toast.error("请在桌面应用中下载 LaTeX 模板。")
      return
    }
    templateDownloadInFlight.current = true
    setTemplateDownloading(true)
    try {
      const result = await api.downloadThesisTemplate()
      if (result.saved) toast.success("LaTeX 模板已保存，解压后打开 README.md 开始使用。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板下载失败，请重试。")
    } finally {
      templateDownloadInFlight.current = false
      setTemplateDownloading(false)
    }
  }
  const isAssessmentBodySection = isAssessment && ["assessment_comments", "assessment_division"].includes(activeSection)
  const immersiveSection = isAssessment
    ? isAssessmentBodySection
    : isTaskBook
    ? [
        "task_basic",
        "task_materials",
        "task_references",
        "task_topic",
      ].includes(activeSection)
    : isMidterm
      ? activeSection === "midterm_research" || activeSection === "midterm_progress"
      : [
          "proposal_significance",
          "proposal_research",
          "proposal_methods",
          "proposal_steps",
          "proposal_references",
        ].includes(activeSection)

  useEffect(() => {
    const viewports = scrollRootRef.current?.querySelectorAll<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    const viewport = immersiveSection
      ? viewports?.item((viewports?.length ?? 1) - 1)
      : viewports?.item(0)
    if (!viewport) return
    viewport.scrollTop = viewState.scrollTop
    const rememberScroll = () => {
      onViewStateChange((current) => ({
        ...current,
        scrollTop: viewport.scrollTop,
      }))
    }
    viewport.addEventListener("scroll", rememberScroll, { passive: true })
    return () => {
      rememberScroll()
      viewport.removeEventListener("scroll", rememberScroll)
    }
  }, [
    activeSection,
    documentId,
    immersiveSection,
    onViewStateChange,
    viewState.scrollTop,
  ])

  const rememberSelection = (
    field: StructuredEditorField,
    selection: EditorSelectionSnapshot,
  ) => {
    onViewStateChange((current) => ({
      ...current,
      selections: { ...current.selections, [field]: selection },
    }))
  }
  const editorLocationProps = (field: StructuredEditorField) => ({
    selectionSnapshot: viewState.selections[field],
    onSelectionChange: (selection: EditorSelectionSnapshot) =>
      rememberSelection(field, selection),
  })
  const figureChapters: FigureChapterOption[] = isMidterm
    ? draft.directory
        .filter((item) => item.level === 1)
        .map((item, index) => ({
          value: index + 1,
          label: `${item.number.trim() || `第 ${index + 1} 章`} ${paragraphInputText(item.title).trim()}`.trim(),
        }))
    : [{ value: 1, label: "正文" }]
  const figureBodies = isTaskBook
    ? [draft.taskBasicContent, draft.taskRequiredMaterials]
    : isMidterm
      ? [draft.mainResearchContent, draft.progress]
      : [draft.researchContent, draft.methods, draft.steps]
  const figureCatalog = structuredFigureCatalog(...figureBodies)
  const figureLabels = Object.fromEntries(
    figureCatalog.map((figure) => [figure.id, figure.label]),
  )
  Object.assign(figureLabels, structuredProcessEquationLabels(...figureBodies))
  const isTemplateSection = isThesis && activeSection === "thesis_template"
  const DocumentScrollContainer = immersiveSection || isTemplateSection ? "div" : ScrollArea
  const hasRichTextToolbar = isAssessmentBodySection || [
    "task_basic", "task_materials", "midterm_research", "midterm_progress",
    "proposal_significance", "proposal_research", "proposal_methods", "proposal_steps",
  ].includes(activeSection)
  const EditorSurface = immersiveSection ? "div" : Card
  const EditorSurfaceContent = immersiveSection ? "div" : CardContent
  const documentFooterStatus = <SaveStatusBadge state={saveState} quiet />

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" ref={scrollRootRef}>
    <h1 className="sr-only">{documentTypeLabels[documentType]}</h1>
    {!hasRichTextToolbar && toolbarActions ? (
      <div data-slot="document-action-bar" className="flex h-(--header-height) shrink-0 items-center justify-end gap-2 border-b bg-background px-4">
        {toolbarActions}
      </div>
    ) : null}
    <DocumentScrollContainer className={cn("min-h-0 flex-1", isTemplateSection && "overflow-y-auto")}>
      <div
        className={cn(
          isTemplateSection
            ? "flex min-h-full w-full flex-col gap-6 p-6"
            : immersiveSection
            ? "flex h-full min-h-0 w-full flex-col"
            : "mx-auto grid max-w-4xl gap-6 p-6",
        )}
      >

        {!isThesis && !needsDocumentProfile && !(isAssessment ? assessmentProfileIsComplete(draft) : profileIsComplete(draft)) && workspace.status === "ready" ? (
          <Alert>
            <UserRoundIcon />
            <AlertTitle>基本信息尚未补全</AlertTitle>
            <AlertDescription>可先写正文，预览或导出前在左侧补全「档案与基本信息」。</AlertDescription>
          </Alert>
        ) : null}

        {!isThesis && !needsDocumentProfile && !structuredBodyPlainText(draft.title).trim() &&
        workspace.status === "ready" ? (
          <Alert>
            <UserRoundIcon />
            <AlertTitle>论文题目尚未填写</AlertTitle>
            <AlertDescription>
              请在「基本信息」填写论文题目。
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace.status === "loading" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在载入工作区</AlertTitle>
            <AlertDescription>
              正在恢复上次使用的档案和
              {documentTypeLabels[documentType]}。
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace.status === "error" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>工作区载入失败</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>{workspace.message}</span>
              <Button variant="outline" size="sm" disabled={retryLoadDisabled} onClick={onRetryLoad}>
                <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                重新载入
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {saveState === "error" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>修改尚未保存，请重试。关闭窗口前请复制未保存的内容。</span>
              <Button variant="outline" size="sm" onClick={onRetrySave}>
                <AnimatedActionIcon icon={SaveIconAnimated} />
                重试保存
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {recoveryAvailable ? (
          <Alert>
            <SaveIcon />
            <AlertTitle>已保留重新载入前的草稿</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>{recoveryRestored ? "保留的草稿已恢复，成功保存后会移除副本。" : "可以恢复保留的内容，或使用当前版本并移除副本。"}</span>
              {!recoveryRestored ? <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={disabled || saveState === "saving" || saveState === "conflict"} onClick={onRestoreRecovery}>
                  恢复保留草稿
                </Button>
                <Button variant="outline" size="sm" disabled={disabled || saveState === "saving" || saveState === "conflict"} onClick={onDismissRecovery}>
                  使用当前版本并移除副本
                </Button>
              </div> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {saveState === "conflict" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>版本冲突</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>当前草稿与已保存版本不一致。重新载入将保留当前草稿副本，可在载入后恢复。</span>
              <Button variant="outline" size="sm" disabled={retryLoadDisabled} onClick={onRetryLoad}>
                <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                重新载入
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {isAssessmentDocumentType(documentType) && !isAssessmentBodySection ? <AssessmentDocumentEditor type={documentType} activeSection={activeSection} value={draft.assessment} onChange={onAssessmentChange} disabled={disabled} sharedInformation={[{ label: "论文题目", value: inlineParagraphFromBody(draft.title) }, { label: "姓名", value: draft.studentName }, { label: "学号", value: draft.studentId }, { label: "学院", value: draft.college }, { label: "专业", value: draft.major }, ...(documentType === "advisor_review" ? [{ label: "指导教师", value: draft.advisor }, { label: "指导教师职称", value: draft.advisorTitle }] : [])]} /> : null}

        {isTemplateSection ? (
          <Card className="my-auto w-full max-w-lg shrink-0 self-center border-0 bg-transparent text-center shadow-none ring-0">
            <CardHeader className="justify-items-center gap-3">
              <CardTitle className="text-sm font-medium">毕业论文 LaTeX 模板</CardTitle>
              <CardDescription className="text-sm leading-6">下载后解压，在 LaTeX 编辑器或 Agent 中打开工程文件夹。</CardDescription>
            </CardHeader>
            <CardContent className="grid justify-items-center gap-4">
              <Button type="button" disabled={templateDownloading} onClick={() => void downloadTemplate()} className="w-fit">
                <AnimatedActionIcon icon={DownloadIcon} />
                {templateDownloading ? "正在保存模板…" : "下载 LaTeX 模板"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {activeSection === "document_info" && isMidterm ? (
        <Card className="border-0 shadow-none ring-0">
          <CardContent>
            <DocumentDateField
              id="checkDate"
              label="检查日期"
              orientation="horizontal"
              value={draft.checkDate}
              allowedRange={midtermDateRule}
              placeholder="选择检查日期"
              error={
                isValidDraftDate(draft.checkDate) && midtermDateIsAllowed(draft.checkDate, midtermDateRule)
                  ? undefined
                  : "请选择有效的检查日期。"
              }
              onChange={(value) => onChange("checkDate", value)}
              disabled={disabled}
            />
          </CardContent>
        </Card>
        ) : null}

        {isTaskBook &&
        graduationYearFromCohort(draft.graduationCohort) === null ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>毕业届别缺少年份</AlertTitle>
            <AlertDescription>
              请在“基本信息”填写含四位年份的毕业届别，例如“2026届”。
            </AlertDescription>
          </Alert>
        ) : null}

        {isAssessmentDocumentType(documentType) && isAssessmentBodySection && !assessmentDocumentRegistry[documentType].lowerEditingEnabled ? <Alert><AlertTitle>评审内容当前仅供查看</AlertTitle></Alert> : null}
        {!isThesis && activeSection !== "document_info" && (!isAssessment || isAssessmentBodySection) ? (
        <EditorSurface
          className={cn(
            immersiveSection ? "min-h-0 flex-1" : "border-0 shadow-none ring-0",
            isTaskBook && activeSection === "task_schedule"
              ? "bg-transparent"
              : isMidterm && activeSection === "midterm_directory"
                ? "bg-transparent"
              : undefined,
          )}
          {...(immersiveSection
            ? { "data-slot": "immersive-writing-surface" }
            : {})}
        >
          <EditorSurfaceContent
            className={cn(
              immersiveSection ? "h-full min-h-0" : "grid gap-6",
            )}
          >
            {isAssessmentDocumentType(documentType) && isAssessmentBodySection ? (
              <StructuredBodyField
                id={activeSection === "assessment_division" ? "assessmentDivisionOfWork" : "assessmentComments"}
                {...editorLocationProps(activeSection === "assessment_division" ? "assessmentDivisionOfWork" : "assessmentComments")}
                label={activeSection === "assessment_division" ? "合作课题分工情况" : documentType === "grade_assessment" ? "答辩小组意见" : "评审意见"}
                description=""
                value={activeSection === "assessment_division" ? draft.assessment.divisionOfWork : draft.assessment.comments}
                guidance={activeSection === "assessment_division" ? draft.assessment.writingGuidance.divisionOfWork : draft.assessment.writingGuidance.comments}
                onChange={(_, value, guidance) => {
                  const field = activeSection === "assessment_division" ? "divisionOfWork" : "comments"
                  onAssessmentChange({ ...draft.assessment, [field]: value, writingGuidance: { ...draft.assessment.writingGuidance, [field]: guidance ?? null } })
                }}
                disabled={disabled || !assessmentDocumentRegistry[documentType].lowerEditingEnabled}
                toolbarActions={toolbarActions}
                footerStatus={documentFooterStatus}
                fillHeight
              />
            ) : isTaskBook ? (
              <>
                {activeSection === "task_basic" ? (
                  <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                    id="taskBasicContent"
                    {...editorLocationProps("taskBasicContent")}
                    label="内容要求"
                    description="填写课题任务、成果要求和完成标准。"
                    value={draft.taskBasicContent}
                    error={
                      !structuredBodyHasText(draft.taskBasicContent)
                        ? "请填写至少一段内容要求。"
                        : draft.taskBasicContent.length > 80
                          ? "“内容要求”最多支持 80 个内容块，请删减后重试。"
                          : undefined
                    }
                    onChange={onStructuredBodyChange}
                    disabled={disabled}
                    fillHeight
                    enableFigures
                    figureChapters={figureChapters}
                    figureCatalog={figureCatalog}
                    figureNumbering={{ knownLabels: figureLabels }}
                  />
                ) : null}
                {activeSection === "task_schedule" ? (
                  <TaskScheduleEditor
                    key={documentId}
                    value={draft.taskSchedule}
                    onChange={onTaskScheduleChange}
                    disabled={disabled}
                    validationRequested={validationRequested}
                  />
                ) : null}
                {activeSection === "task_materials" ? (
                  <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                    id="taskRequiredMaterials"
                    {...editorLocationProps("taskRequiredMaterials")}
                    label="需收集的资料及主要参考文献资料"
                    description="填写完成任务需要收集的资料；该项可留空。"
                    value={draft.taskRequiredMaterials}
                    error={
                      draft.taskRequiredMaterials.length > 50
                        ? "“需收集资料”最多支持 50 个内容块，请删减后重试。"
                        : undefined
                    }
                    onChange={onStructuredBodyChange}
                    disabled={disabled}
                    fillHeight
                    enableFigures
                    figureChapters={figureChapters}
                    figureCatalog={figureCatalog}
                    figureNumbering={{
                      startCounts: structuredFigureChapterCounts(draft.taskBasicContent),
                      knownLabels: figureLabels,
                    }}
                  />
                ) : null}
                {activeSection === "task_references" ? (
                  <ReferenceImporter
                    footerStatus={documentFooterStatus}
                    source={draft.taskReferencesBibtex}
                    legacyReferences={draft.taskReferences}
                    maximumEntries={TASK_BOOK_REFERENCE_RULES.maximumEntries}
                    maximumReferenceLength={
                      TASK_BOOK_REFERENCE_RULES.maximumReferenceLength
                    }
                    onChange={(source) =>
                      onChange("taskReferencesBibtex", source)
                    }
                    disabled={disabled}
                  />
                ) : null}
                {activeSection === "task_topic" ? (
                <div
                  data-slot="task-topic-surface"
                  className="flex h-full min-h-0 items-center justify-center p-6"
                >
                <div
                  data-slot="task-topic-form"
                  className="grid w-full max-w-xl gap-4"
                >
                  <Field
                    orientation="horizontal"
                    id="taskNature"
                    label="选题性质"
                    value={draft.taskNature}
                    options={TASK_NATURE_OPTIONS}
                    placeholder="请选择选题性质"
                    error={draft.taskNature ? undefined : "请选择选题性质。"}
                    onChange={onChange}
                    disabled={disabled}
                  />
                  <Field
                    orientation="horizontal"
                    id="taskSourceType"
                    label="课题来源"
                    value={draft.taskSourceType}
                    options={TASK_SOURCE_TYPE_OPTIONS}
                    placeholder="请选择课题来源"
                    error={draft.taskSourceType ? undefined : "请选择课题来源。"}
                    onChange={onChange}
                    disabled={disabled}
                  />
                  {draft.taskSourceType === "research_project" ? (
                    <>
                      <Field
                        orientation="horizontal"
                        id="taskResearchLevel"
                        label="科研项目级别"
                        value={draft.taskResearchLevel}
                        options={TASK_RESEARCH_LEVEL_OPTIONS}
                        placeholder="请选择项目级别"
                        error={
                          draft.taskResearchLevel
                            ? undefined
                            : "请选择科研项目级别。"
                        }
                        onChange={onChange}
                        disabled={disabled}
                      />
                      <Field
                        orientation="horizontal"
                        id="taskProjectNumber"
                        label="项目编号"
                        value={draft.taskProjectNumber}
                        placeholder="请输入科研项目编号"
                        maxLength={50}
                        error={
                          draft.taskProjectNumber.trim()
                            ? undefined
                            : "请输入科研项目编号。"
                        }
                        onChange={onChange}
                        disabled={disabled}
                      />
                      {draft.taskResearchLevel === "other" ? (
                        <div>
                          <Field
                            orientation="horizontal"
                            id="taskOtherResearchLevel"
                            label="其他项目级别"
                            value={draft.taskOtherResearchLevel}
                            placeholder="请输入其他科研项目级别"
                            maxLength={50}
                            error={
                              draft.taskOtherResearchLevel.trim()
                                ? undefined
                                : "请输入其他科研项目级别。"
                            }
                            onChange={onChange}
                            disabled={disabled}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {draft.taskSourceType === "self_proposed" ? (
                    <Field
                      orientation="horizontal"
                      id="taskSelfProposedBy"
                      label="自拟人"
                      value={draft.taskSelfProposedBy}
                      options={TASK_SELF_PROPOSED_BY_OPTIONS}
                      placeholder="请选择自拟人"
                      error={
                        draft.taskSelfProposedBy
                          ? undefined
                          : "请选择自拟人。"
                      }
                      onChange={onChange}
                      disabled={disabled}
                    />
                  ) : null}
                </div>
                </div>
                ) : null}
              </>
            ) : isMidterm ? (
              <>
                {activeSection === "midterm_directory" ? (
                <div className="grid gap-2">
                  <OutlineEditor
                    value={draft.directory}
                    numberingStyle={draft.directoryNumberingStyle}
                    onChange={onDirectoryChange}
                    onNumberingStyleChange={onDirectoryNumberingStyleChange}
                    disabled={disabled}
                  />
                </div>
                ) : null}
                {activeSection === "midterm_research" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="mainResearchContent"
                  {...editorLocationProps("mainResearchContent")}
                  label="研究内容"
                  description="填写当前论文的主要研究内容，可组合段落和列表。"
                  value={draft.mainResearchContent}
                  startOnNewParagraph={
                    draft.mainResearchContent.length === 1 &&
                    isParagraphInput(draft.mainResearchContent[0]) &&
                    paragraphInputPlainText(draft.mainResearchContent[0]).trim() === midtermStarterParagraphs.mainResearchContent
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableDocumentTools
                  enableProcessEquations
                  enableFigures
                  figureChapters={figureChapters}
                  figureCatalog={figureCatalog}
                  figureNumbering={{ knownLabels: figureLabels }}
                />
                ) : null}
                {activeSection === "midterm_progress" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="progress"
                  {...editorLocationProps("progress")}
                  label="毕业论文（设计）进展情况"
                  description="按实际完成情况填写，可组合段落和列表。"
                  value={draft.progress}
                  startOnNewParagraph={
                    draft.progress.length === 1 &&
                    isParagraphInput(draft.progress[0]) &&
                    paragraphInputPlainText(draft.progress[0]).trim() === midtermStarterParagraphs.progress
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableDocumentTools
                  enableProcessEquations
                  enableFigures
                  figureChapters={figureChapters}
                  figureCatalog={figureCatalog}
                  figureNumbering={{
                    startCounts: structuredFigureChapterCounts(draft.mainResearchContent),
                    equationStartCounts: structuredProcessEquationChapterCounts(draft.mainResearchContent),
                    knownLabels: figureLabels,
                  }}
                />
                ) : null}
              </>
            ) : (
              <>
                {activeSection === "proposal_significance" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="significance"
                  {...editorLocationProps("significance")}
                  label="本选题的意义及国内外发展状况"
                  description="请分别说明选题意义和国内外发展状况，至少填写两个段落。"
                  value={draft.significance}
                  mode="paragraphs"
                  error={
                    draft.significance.filter((paragraph) =>
                      paragraphInputPlainText(paragraph).trim(),
                    ).length < 2
                      ? "请填写至少两个段落。"
                      : undefined
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableProcessEquations
                />
                ) : null}
                {activeSection === "proposal_research" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="researchContent"
                  {...editorLocationProps("researchContent")}
                  label="研究内容"
                  description="说明研究对象、主要问题和拟完成内容。"
                  value={draft.researchContent}
                  startOnNewParagraph={
                    draft.researchContent.length === 1 &&
                    isParagraphInput(draft.researchContent[0]) &&
                    paragraphInputPlainText(draft.researchContent[0]).trim() === proposalStarterParagraphs.researchContent
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableFigures
                  enableProcessEquations
                  figureChapters={figureChapters}
                  figureCatalog={figureCatalog}
                  figureNumbering={{ knownLabels: figureLabels }}
                />
                ) : null}
                {activeSection === "proposal_methods" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="methods"
                  {...editorLocationProps("methods")}
                  label="研究方法与手段"
                  description="与研究步骤分开填写。"
                  value={draft.methods}
                  startOnNewParagraph={
                    draft.methods.length === 1 &&
                    isParagraphInput(draft.methods[0]) &&
                    paragraphInputPlainText(draft.methods[0]).trim() === proposalStarterParagraphs.methods
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableFigures
                  enableProcessEquations
                  figureChapters={figureChapters}
                  figureCatalog={figureCatalog}
                  figureNumbering={{
                    startCounts: structuredFigureChapterCounts(draft.researchContent),
                    equationStartCounts: structuredProcessEquationChapterCounts(draft.researchContent),
                    knownLabels: figureLabels,
                  }}
                />
                ) : null}
                {activeSection === "proposal_steps" ? (
                <StructuredBodyField
                  toolbarActions={toolbarActions}
                  footerStatus={documentFooterStatus}
                  id="steps"
                  {...editorLocationProps("steps")}
                  label="研究步骤"
                  description="按实际推进顺序填写。"
                  value={draft.steps}
                  startOnNewParagraph={
                    draft.steps.length === 1 &&
                    isParagraphInput(draft.steps[0]) &&
                    paragraphInputPlainText(draft.steps[0]).trim() === proposalStarterParagraphs.steps
                  }
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                  enableFigures
                  enableProcessEquations
                  figureChapters={figureChapters}
                  figureCatalog={figureCatalog}
                  figureNumbering={{
                    startCounts: structuredFigureChapterCounts(
                      draft.researchContent,
                      draft.methods,
                    ),
                    equationStartCounts: structuredProcessEquationChapterCounts(
                      draft.researchContent,
                      draft.methods,
                    ),
                    knownLabels: figureLabels,
                  }}
                />
                ) : null}
                {activeSection === "proposal_references" ? (
                <ReferenceImporter
                  footerStatus={documentFooterStatus}
                  source={draft.referencesBibtex}
                  legacyReferences={draft.references}
                  maximumEntries={PROPOSAL_REFERENCE_RULES.maximumEntries}
                  maximumReferenceLength={
                    PROPOSAL_REFERENCE_RULES.maximumReferenceLength
                  }
                  onChange={(source) => onChange("referencesBibtex", source)}
                  disabled={disabled}
                />
                ) : null}
              </>
            )}
          </EditorSurfaceContent>
        </EditorSurface>
        ) : null}
      </div>
    </DocumentScrollContainer>
    {!hasRichTextToolbar && !["task_references", "proposal_references"].includes(activeSection) ? (
      <SaveStatusFooter state={saveState} />
    ) : null}
    </div>
  )
}

function activeTemplateCheck(
  environment: EnvironmentState,
  documentType: DocumentType,
): EnvironmentCheck | undefined {
  if (environment.status !== "ready") return undefined
  const checkId =
    isAssessmentDocumentType(documentType) ? `${documentType}_engine` :
    documentType === "thesis"
      ? "thesis_engine"
      : documentType === "task_book"
      ? "task_book_engine"
      : documentType === "midterm"
        ? "midterm_engine"
        : "proposal_engine"
  return environment.result.checks.find((check) => check.id === checkId)
}

function PaginatedPreviewPanel({
  activePane,
  documentType,
  previewState,
  disabled,
  blockedMessage,
  onGenerate,
  onOpenEnvironmentGuide,
}: {
  activePane: ActivePane
  documentType: DocumentType
  previewState: PreviewState
  disabled: boolean
  blockedMessage?: string
  onGenerate: () => void
  onOpenEnvironmentGuide?: () => void
}) {
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-3 p-4">
        {blockedMessage && activePane !== "profile" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>暂时无法生成预览</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span>{blockedMessage}</span>
              {onOpenEnvironmentGuide ? (
                <Button variant="outline" className="w-fit" onClick={onOpenEnvironmentGuide}>
                  查看环境修复指引
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {previewState.status === "idle" &&
        !blockedMessage &&
        activePane !== "profile" ? (
          <Alert>
            <AnimatedActionIcon icon={FileTextIconAnimated} />
            <AlertTitle>正在准备预览</AlertTitle>
            <AlertDescription>
              保存并检查内容后生成预览。
            </AlertDescription>
          </Alert>
        ) : null}

        {previewState.status === "checking" ? (
          <Alert
            aria-live="polite"
            className="grid-cols-[auto_1fr] items-center gap-x-3"
          >
            <ThinkingOrb
              state="solving"
              size={20}
              className="shrink-0"
              aria-label="正在保存并检查内容"
            />
            <div className="min-w-0">
              <AlertTitle>正在保存并检查内容</AlertTitle>
              <AlertDescription>
                正在检查{documentTypeLabels[documentType]}内容。
              </AlertDescription>
            </div>
          </Alert>
        ) : null}

        {previewState.status === "generating" ? (
          <Alert
            aria-live="polite"
            className="grid-cols-[auto_1fr] items-center gap-x-3"
          >
            <ThinkingOrb
              state="solving"
              size={20}
              className="shrink-0"
              aria-label="正在生成分页预览"
            />
            <div className="min-w-0">
              <AlertTitle>正在生成分页预览</AlertTitle>
              <AlertDescription>
                正在生成{documentTypeLabels[documentType]}预览。
              </AlertDescription>
            </div>
          </Alert>
        ) : null}

        {previewState.status === "error" ? (
          <>
            <Alert variant="destructive" aria-live="assertive">
              <TriangleAlertIcon />
              <AlertTitle>暂时无法生成预览</AlertTitle>
              <AlertDescription>{previewState.message}</AlertDescription>
            </Alert>
            <Button
              variant="outline"
              onClick={onGenerate}
              disabled={disabled}
            >
              <AnimatedActionIcon icon={RefreshCwIconAnimated} />
              重新生成预览
            </Button>
            {previewState.caseId ? <DiagnosticSupport caseId={previewState.caseId} /> : null}
          </>
        ) : null}

        {previewState.status === "ready" ? (
          <>
            {previewState.stale ? (
              <>
                <Alert variant="destructive" aria-live="assertive">
                  <TriangleAlertIcon />
                  <AlertTitle>预览已过期</AlertTitle>
                  <AlertDescription>
                    内容或模板在预览后发生了变化，请重新生成预览再导出。
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={onGenerate}
                  disabled={disabled}
                >
                  <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                  重新生成预览
                </Button>
              </>
            ) : null}
            {previewState.result.pages.map((page) => (
              <div
                key={page.page_number}
                data-slot="preview-page-viewport"
                className="overflow-x-auto"
              >
                <div
                  data-slot="preview-page"
                  className="mx-auto overflow-hidden border bg-background"
                  style={{
                    width: "100%",
                    aspectRatio: "210 / 297",
                  }}
                >
                  <img
                    src={page.data_url}
                    alt={`排版预览第 ${page.page_number} 页`}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="block size-full object-contain"
                  />
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function InspectionPanel({
  environment,
  templateCheck,
  thesisTemplatePending,
  onRefresh,
  onOpenEnvironmentGuide,
  onInstallTemplate,
  templateInstalling,
  exportState,
  onCancelExport,
  history,
  onRefreshHistory,
  onRevealArtifact,
  onDeleteHistory,
}: {
  environment: EnvironmentState
  templateCheck: EnvironmentCheck | undefined
  thesisTemplatePending: boolean
  onRefresh: () => void
  onOpenEnvironmentGuide: () => void
  onInstallTemplate: () => void
  templateInstalling: boolean
  exportState: ExportState
  onCancelExport: () => void
  history: ExportHistoryState
  onRefreshHistory: () => void
  onRevealArtifact: (artifactId: string) => void
  onDeleteHistory: (exportId: string) => Promise<boolean>
}) {
  const [deleteTarget, setDeleteTarget] = useState<ExportJobSummary | null>(null)
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null)
  const templateNeedsRepair =
    templateCheck !== undefined && templateCheck.status !== "pass"

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-5xl gap-4 p-4">
        <Card>
          <CardHeader className="gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle className="text-sm font-medium">当前状态</CardTitle>
                <CardDescription className="text-xs">
                  {environment.status === "loading"
                    ? "正在检查运行环境。"
                    : environment.status === "error"
                      ? "文档服务连接失败，请查看环境检查结果。"
                      : !environment.result.ready
                        ? "运行环境需要修复，请查看缺失项目和安装指引。"
                        : thesisTemplatePending
                          ? "当前文档暂不支持预览和导出。"
                        : templateNeedsRepair
                          ? "当前文档模板需要重新关联。"
                          : "运行环境正常，可以继续检查、预览和导出。"}
                </CardDescription>
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
                  <AnimatedActionIcon icon={RefreshCwIconAnimated} />
                )}
              </Button>
            </div>
          </CardHeader>
          {environment.status === "error" ||
          (environment.status === "ready" && !environment.result.ready) ||
          templateNeedsRepair ? (
            <CardContent>
              <div className="grid gap-3">
                {environment.status === "error" ? (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle className="text-sm font-medium">文档服务未连接</AlertTitle>
                    <AlertDescription className="text-xs">{environment.message}</AlertDescription>
                  </Alert>
                ) : null}
                {environment.status === "ready" && !environment.result.ready ? (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle className="text-sm font-medium">运行环境需要修复</AlertTitle>
                    <AlertDescription className="text-xs">
                      查看缺失项目和安装指引，配置后重新检查。
                    </AlertDescription>
                  </Alert>
                ) : null}
                {environment.status === "error" || (environment.status === "ready" && !environment.result.ready) ? (
                  <Button variant="outline" className="w-fit" onClick={onOpenEnvironmentGuide}>
                    查看环境修复指引
                  </Button>
                ) : null}
                {templateCheck && templateCheck.status !== "pass" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      {templateCheck.message}
                    </p>
                    <Button
                      variant="outline"
                      onClick={onInstallTemplate}
                      disabled={templateInstalling}
                    >
                      {templateInstalling ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : (
                        <PackageCheckIcon />
                      )}
                      {templateInstalling ? "正在关联" : "重新关联模板"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardContent>
            <DiagnosticSupport showSummary caseId={exportState.status === "error" ? exportState.caseId : undefined} />
          </CardContent>
        </Card>

        {exportState.status === "exporting" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle className="text-sm font-medium">正在导出</AlertTitle>
            <AlertDescription className="grid gap-3 text-xs">
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
            <AlertTitle className="text-sm font-medium">导出失败</AlertTitle>
            <AlertDescription className="text-xs">
              {exportState.message}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle className="text-sm font-medium">导出历史</CardTitle>
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
                  <AnimatedActionIcon icon={RefreshCwIconAnimated} />
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
                <AlertTitle className="text-sm font-medium">导出历史读取失败</AlertTitle>
                <AlertDescription className="text-xs">{history.message}</AlertDescription>
              </Alert>
            ) : null}
            {history.status === "ready" && history.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前文档还没有导出记录。</p>
            ) : null}
            {history.jobs.length > 0 ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>产物</TableHead>
                      <TableHead>格式</TableHead>
                      <TableHead>导出时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="w-12 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.jobs.map((job) => {
                      const availableArtifact = job.artifacts.find(
                        (artifact) => artifact.file_state === "available",
                      )
                      return (
                        <TableRow key={job.export_id}>
                          <TableCell className="min-w-48 whitespace-normal">
                            {job.artifacts.length > 0 ? (
                              <div className="grid gap-0.5 text-sm">
                                {job.artifacts.map((artifact) => (
                                  <span key={artifact.artifact_id}>{artifact.display_name}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">未生成产物</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {job.requested_formats
                              .map((item) => item.toUpperCase())
                              .join("、")}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(job.completed_at ?? job.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <ExportHistoryStatusBadge job={job} />
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`管理导出记录 ${new Date(job.created_at).toLocaleString()}`}
                                  />
                                }
                              >
                                <AnimatedActionIcon icon={EllipsisIcon} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  disabled={!availableArtifact}
                                  onClick={() =>
                                    availableArtifact &&
                                    onRevealArtifact(availableArtifact.artifact_id)
                                  }
                                >
                                  <AnimatedActionIcon icon={FolderOpenIconAnimated} />
                                  打开本地位置
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={
                                    job.status === "queued" ||
                                    job.status === "running" ||
                                    deletingExportId === job.export_id
                                  }
                                  onClick={() => setDeleteTarget(job)}
                                >
                                  <AnimatedActionIcon icon={DeleteIcon} />
                                  删除记录
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Dialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && deletingExportId === null) setDeleteTarget(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除这条导出记录？</DialogTitle>
              <DialogDescription>
                仅从列表中移除记录，不会删除已经导出的本地文件。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={deletingExportId !== null}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={!deleteTarget || deletingExportId !== null}
                onClick={async () => {
                  if (!deleteTarget) return
                  setDeletingExportId(deleteTarget.export_id)
                  const deleted = await onDeleteHistory(deleteTarget.export_id)
                  setDeletingExportId(null)
                  if (deleted) setDeleteTarget(null)
                }}
              >
                {deletingExportId ? <LoaderCircleIcon className="animate-spin" /> : <AnimatedActionIcon icon={DeleteIcon} />}
                删除记录
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </ScrollArea>
  )
}

export default function App() {
  useEditableSelection()
  const exportFeedback = useActionFeedback()
  const isMobile = useIsMobile()
  const [draft, setDraft] = useState(emptyDraft)
  const draftRef = useRef(draft)
  const [activeSections, setActiveSections] = useState<Record<DocumentType, string>>(
    defaultDocumentSections,
  )
  const [activePane, setActivePane] = useState<ActivePane>("document")
  const [profileValidationRequested, setProfileValidationRequested] = useState(false)
  const [activeThesisTool, setActiveThesisTool] = useState<ThesisToolId>("three_line_table")
  const [thesisToolSaveStates, setThesisToolSaveStates] = useState<Record<ThesisToolId, SaveState>>({
    three_line_table: "saved",
    general_table: "saved",
    multi_figure: "saved",
  })
  const handleThesisToolSaveStateChange = useCallback(
    (toolId: ThesisToolId, nextState: SaveState) => {
      setThesisToolSaveStates((current) => current[toolId] === nextState
        ? current
        : { ...current, [toolId]: nextState })
    },
    [],
  )
  const [profiles, setProfiles] = useState<StudentProfileSummary[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [deletedProfiles, setDeletedProfiles] = useState<StudentProfileSummary[]>([])
  const [profileToDelete, setProfileToDelete] = useState<StudentProfileSummary | null>(null)
  const [deletedProfilesOpen, setDeletedProfilesOpen] = useState(false)
  const [createProfileOpen, setCreateProfileOpen] = useState(false)
  const [newStudent, setNewStudent] = useState({ full_name: "", student_number: "", college: "", major: "" })
  const [createProfileError, setCreateProfileError] = useState<string | null>(null)
  const profileRef = useRef<StudentProfile | null>(null)
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const documentRef = useRef<DocumentRecord | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [deletedDocuments, setDeletedDocuments] = useState<DocumentRecord[]>([])
  const [documentPages, setDocumentPages] = useState<{
    active: DocumentListPageState | null
    deleted: DocumentListPageState | null
  }>({ active: null, deleted: null })
  const documentPagesRef = useRef(documentPages)
  const documentListGeneration = useRef(0)
  const [documentListsLoading, setDocumentListsLoading] = useState({ active: false, deleted: false })
  const documentListsLoadingRef = useRef({ active: false, deleted: false })
  const revisionRef = useRef(0)
  const [documentTransitioning, setDocumentTransitioning] = useState(false)
  const documentTransitioningRef = useRef(false)
  const documentTransitionPromise = useRef<Promise<void> | null>(null)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeSavePromise = useRef<Promise<boolean> | null>(null)
  const [recovery, setRecovery] = useState<WorkspaceRecovery | null>(null)
  const [recoveryRestored, setRecoveryRestored] = useState(false)
  const appliedRecovery = useRef<WorkspaceRecovery | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceLoadState>({
    status: "loading",
  })
  const workspaceReadyRef = useRef(false)
  const [saveState, setRenderedSaveState] = useState<SaveState>("loading")
  const saveStateRef = useRef<SaveState>("loading")
  const setSaveState = useCallback((next: SaveState) => {
    saveStateRef.current = next
    setRenderedSaveState(next)
  }, [])
  const [environment, setEnvironment] = useState<EnvironmentState>({
    status: "loading",
  })
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle" })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewDrawerMaxWidth, setPreviewDrawerMaxWidth] = useState(
    getPreviewDrawerMaxWidth,
  )
  const [previewDrawerWidth, setPreviewDrawerWidth] = useState(() =>
    clampPreviewDrawerWidth(
      PREVIEW_DRAWER_DEFAULT_WIDTH,
      getPreviewDrawerMaxWidth(),
    ),
  )
  const [previewPanelInitialWidth, setPreviewPanelInitialWidth] = useState(PREVIEW_DRAWER_DEFAULT_WIDTH)
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" })
  const [history, setHistory] = useState<ExportHistoryState>({
    status: "loading",
    jobs: [],
  })
  const [templateInstalling, setTemplateInstalling] = useState(false)
  const [generatedDocumentCount, setGeneratedDocumentCount] = useState<number | null>(
    null,
  )
  const [environmentGuideOpen, setEnvironmentGuideOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "unconfigured",
  })
  const [midtermDatePolicyStatus, setMidtermDatePolicyStatus] = useState<MidtermDatePolicyStatus>({
    state: "unconfigured",
    rules: [],
  })
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    null,
  )
  const [dismissedAnnouncementId, setDismissedAnnouncementId] = useState<string | null>(
    null,
  )
  const [maintenanceDismissed, setMaintenanceDismissed] = useState(false)
  const activeDocumentId = document?.id
  const activeDocumentIdRef = useRef<string | null>(activeDocumentId ?? null)
  useEffect(() => {
    activeDocumentIdRef.current = activeDocumentId ?? null
  }, [activeDocumentId])
  useEffect(() => {
    const syncPreviewDrawerBounds = () => {
      const maxWidth = getPreviewDrawerMaxWidth()
      setPreviewDrawerMaxWidth(maxWidth)
      setPreviewDrawerWidth((current) =>
        clampPreviewDrawerWidth(current, maxWidth),
      )
    }
    window.addEventListener("resize", syncPreviewDrawerBounds)
    return () => window.removeEventListener("resize", syncPreviewDrawerBounds)
  }, [])
  const handlePreviewPanelResize = useCallback(({ inPixels }: { inPixels: number }) => {
    if (!isMobile && inPixels > 0) {
      setPreviewDrawerWidth(clampPreviewDrawerWidth(Math.round(inPixels), previewDrawerMaxWidth))
    }
  }, [isMobile, previewDrawerMaxWidth])
  const activeDocumentType = documentTypeFromRecord(document?.document_type)
  const midtermDateRule = midtermDateRuleForCollege(midtermDatePolicyStatus.rules, draft.college)
  const sections = documentSectionOptions(draft, activeDocumentType, midtermDateRule)
  const activeSection = sections.some(section => section.id === activeSections[activeDocumentType])
    ? activeSections[activeDocumentType]
    : sections[0].id
  const editVersion = useRef(0)
  const autosaveVersions = useRef(createAutosaveVersionState())
  const saving = useRef(false)
  const savingPromise = useRef<Promise<boolean> | null>(null)
  const documentViewStates = useMemo(() => new DocumentViewStateStore(), [])
  const pendingCheckTarget = useRef<CheckNavigationTarget | null>(null)
  const previewCheckTarget = useRef<CheckNavigationTarget | null>(null)
  const activeViewStateKey = activeDocumentId
    ? `${activeDocumentId}:${activeSection}`
    : ""
  const activeDocumentViewState =
    documentViewStates.read(activeViewStateKey) ?? {
      scrollTop: 0,
      selections: {},
    }
  const updateActiveDocumentViewState = useCallback(
    (update: (current: DocumentViewState) => DocumentViewState) => {
      if (!activeDocumentId) return
      const key = `${activeDocumentId}:${activeSection}`
      documentViewStates.update(key, update)
    },
    [activeDocumentId, activeSection, documentViewStates],
  )
  const navigateToCheck = useCallback(
    (target: CheckNavigationTarget) => {
      pendingCheckTarget.current = target
      previewCheckTarget.current = target
      setPreviewOpen(false)
      if (target.sectionId) {
        setActiveSections((current) => ({
          ...current,
          [activeDocumentType]: target.sectionId ?? current[activeDocumentType],
        }))
      }
      setActivePane(target.pane)
    },
    [activeDocumentType],
  )

  useEffect(() => {
    const target = pendingCheckTarget.current
    if (
      !target ||
      previewOpen ||
      activePane !== target.pane ||
      (target.sectionId !== undefined && activeSection !== target.sectionId)
    ) {
      return
    }
    // Effects run after the destination field is committed. Do not depend on an
    // animation frame: validation navigation must also work in hidden windows.
    {
      const root = window.document.querySelector<HTMLElement>(target.selector)
      if (!root) return
      const focusable = root.matches(
        'button, input, textarea, select, [contenteditable="true"], [tabindex]',
      )
        ? root
        : root.querySelector<HTMLElement>(
            'button, input, textarea, select, [contenteditable="true"], [tabindex]',
          )
      focusable?.focus()
      root.scrollIntoView?.({ block: "center" })
      pendingCheckTarget.current = null
    }
  }, [activePane, activeSection, previewOpen])

  const recordTelemetry = useCallback((input: TelemetryUsageEvent) => {
    if (("documentType" in input && input.documentType === "thesis") || ("view" in input && input.view === "thesis")) return
    const api = getDesktopApi()
    if (!api) return
    void api.recordTelemetry(input).catch(() => undefined)
  }, [])

  const loadRemoteServiceState = useCallback(async () => {
    const api = getDesktopApi()
    if (!api) return
    const [update, datePolicy] = await Promise.allSettled([
      api.getUpdateStatus(),
      api.getMidtermDatePolicyStatus(),
    ])
    if (update.status === "fulfilled") setUpdateStatus(update.value)
    if (datePolicy.status === "fulfilled") setMidtermDatePolicyStatus(datePolicy.value)
  }, [])

  const isCurrentSavedRevision = (documentId: string, version: number) =>
    activeDocumentIdRef.current === documentId &&
    editVersion.current === version &&
    saveStateRef.current === "saved"

  const applyWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, fallback?: Draft, prefillNewProposal = false) => {
      const api = getDesktopApi()
      if (!api) throw new Error("请在桌面应用中打开工作台。")

      documentListGeneration.current += 1
      documentListsLoadingRef.current = { active: false, deleted: false }
      setDocumentListsLoading({ active: false, deleted: false })
      setSelectedProfileId(snapshot.profile?.id ?? null)
      setProfiles(snapshot.profiles ?? (snapshot.profile ? [snapshot.profile] : []))
      setDeletedProfiles(snapshot.deleted_profiles ?? [])
      let activeDocument = snapshot.document
      if (!activeDocument && (snapshot.profiles?.length || snapshot.deleted_profiles?.length)) {
        const resolved = draftFromRecords(snapshot.profile, snapshot.profile_draft, null)
        profileRef.current = snapshot.profile
        documentRef.current = null
        activeDocumentIdRef.current = null
        revisionRef.current = 0
        draftRef.current = resolved
        setDraft(resolved)
        setDocument(null)
        setDocuments(snapshot.documents)
        setDeletedDocuments(snapshot.deleted_documents ?? [])
        const pages = { active: snapshot.documents_page ?? null, deleted: snapshot.deleted_documents_page ?? null }
        documentPagesRef.current = pages
        setDocumentPages(pages)
        editVersion.current = 0
        const fingerprints = autosaveFingerprintsForDraft(resolved, "proposal")
        autosaveVersions.current = createAutosaveVersionState({ profileFingerprint: fingerprints.profile, documentFingerprint: fingerprints.document })
        setProfileValidationRequested(false)
        setPreviewState({ status: "idle" })
        setPreviewOpen(false)
        setExportState({ status: "idle" })
        setHistory({ status: "ready", jobs: [] })
        appliedRecovery.current = null
        setRecoveryRestored(false)
        setRecovery(null)
        setSaveState("saved")
        workspaceReadyRef.current = true
        setWorkspace({ status: "ready" })
        setActivePane("profile")
        return
      }
      const createdProposal = !activeDocument
      if (!activeDocument) {
        const initial = fallback ?? newProposalDraft()
        activeDocument = await api.createDocument({
          profile_id: snapshot.profile?.id ?? null,
          document_type: "proposal",
          template_version: "0.1.0-dev.1",
          schema_version: "0.2",
          title: defaultDocumentTitle("proposal", profileDraftValue(
            snapshot.profile_draft,
            "full_name",
            snapshot.profile?.full_name || initial.studentName,
          )),
        })
      }

      const resolvedDocument = activeDocument
      const shouldPrefillProposal =
        (createdProposal || prefillNewProposal) &&
        resolvedDocument.document_type === "proposal" &&
        resolvedDocument.content === null
      const shouldPrefillAssessment = isAssessmentDocumentType(resolvedDocument.document_type) && !Object.hasOwn(recordValue(recordValue(resolvedDocument.content).sections), "writing_guidance")
      const shouldPrefillMidterm =
        resolvedDocument.document_type === "midterm" && resolvedDocument.content === null
      const shouldMigrateMidterm =
        resolvedDocument.document_type === "midterm" &&
        resolvedDocument.content !== null &&
        recordValue(recordValue(resolvedDocument.content).sections).editable_headings !== true
      const draftFallback = fallback ?? (
        shouldPrefillProposal ? newProposalDraft() :
        shouldPrefillMidterm ? newMidtermDraft() : undefined
      )
      const resolvedDraft = draftFromRecords(
        snapshot.profile,
        snapshot.profile_draft,
        resolvedDocument,
        draftFallback,
      )
      profileRef.current = snapshot.profile
      documentRef.current = resolvedDocument
      activeDocumentIdRef.current = resolvedDocument.id
      draftRef.current = resolvedDraft
      setDocument(resolvedDocument)
      setDocuments(
        snapshot.documents?.some((item) => item.id === resolvedDocument.id)
          ? snapshot.documents
          : [...(snapshot.documents ?? []), resolvedDocument],
      )
      setDeletedDocuments(snapshot.deleted_documents ?? [])
      const nextPages = {
        active: snapshot.documents_page ?? null,
        deleted: snapshot.deleted_documents_page ?? null,
      }
      documentPagesRef.current = nextPages
      setDocumentPages(nextPages)
      setProfileValidationRequested(false)
      revisionRef.current = currentRevision(resolvedDocument)
      setDraft(resolvedDraft)
      setPreviewState({ status: "idle" })
      setExportState({ status: "idle" })
      setHistory({ status: "loading", jobs: [] })
      appliedRecovery.current = null
      setRecoveryRestored(false)
      setRecovery(readWorkspaceRecovery(resolvedDocument.id, documentTypeFromRecord(resolvedDocument.document_type)))
      editVersion.current = 0
      const initialFingerprints = autosaveFingerprintsForDraft(
        resolvedDraft,
        documentTypeFromRecord(resolvedDocument.document_type),
      )
      // A profile draft may have been saved while an older document's additional
      // required fields were empty. Assessment printing needs the basic profile
      // persisted and linked, even when the draft itself is already saved.
      const shouldPromoteAssessmentProfile = (snapshot.profile || (!snapshot.profiles?.length && !snapshot.deleted_profiles?.length)) &&
        isAssessmentDocumentType(resolvedDocument.document_type) &&
        assessmentProfileIsComplete(resolvedDraft) && (
          !snapshot.profile || initialFingerprints.profile !== autosaveFingerprint(profileDraftFromDraft(
            draftFromRecords(snapshot.profile, null, resolvedDocument),
          ))
        )
      autosaveVersions.current = createAutosaveVersionState({
        profileDirty: Boolean(fallback) || shouldPromoteAssessmentProfile,
        documentDirty: Boolean(fallback) || shouldPrefillProposal || shouldPrefillMidterm || shouldMigrateMidterm || shouldPrefillAssessment,
        profileFingerprint: shouldPromoteAssessmentProfile ? undefined : initialFingerprints.profile,
        documentFingerprint: shouldPrefillProposal || shouldPrefillMidterm || shouldMigrateMidterm || shouldPrefillAssessment ? undefined : initialFingerprints.document,
      })
      setSaveState(fallback || shouldPrefillProposal || shouldPrefillMidterm || shouldMigrateMidterm || shouldPrefillAssessment || shouldPromoteAssessmentProfile ? "dirty" : "saved")
      workspaceReadyRef.current = true
      setWorkspace({ status: "ready" })
    },
    [setSaveState],
  )

  const loadMoreDocuments = useCallback(async (deleted: boolean) => {
    const api = getDesktopApi()
    const key = deleted ? "deleted" : "active"
    const page = documentPagesRef.current[key]
    if (!api || !page?.has_more || !page.next_cursor ||
        documentListsLoadingRef.current[key] || documentTransitioningRef.current || closingRef.current) return
    const generation = documentListGeneration.current
    documentListsLoadingRef.current[key] = true
    setDocumentListsLoading((current) => ({ ...current, [key]: true }))
    try {
      const result = await api.listDocuments({
        profileId: page.profile_id,
        deleted,
        cursor: page.next_cursor,
        limit: 100,
      })
      if (generation !== documentListGeneration.current) return
      const merge = (current: DocumentRecord[]) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.documents.filter((item) => {
          if (seen.has(item.id)) return false
          seen.add(item.id)
          return true
        })]
      }
      if (deleted) setDeletedDocuments(merge)
      else setDocuments(merge)
      const nextPages = { ...documentPagesRef.current, [key]: {
        profile_id: result.profile_id,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
      } }
      documentPagesRef.current = nextPages
      setDocumentPages(nextPages)
    } catch (error) {
      if (generation === documentListGeneration.current) {
        toast.error(error instanceof Error ? error.message : "文档列表载入失败，请重试。")
      }
    } finally {
      if (generation === documentListGeneration.current) {
        documentListsLoadingRef.current[key] = false
        setDocumentListsLoading((current) => ({ ...current, [key]: false }))
      }
    }
  }, [])

  const openWorkspace = useCallback(
    async (nextMode: WorkspaceMode, fallback?: Draft) => {
      const api = getDesktopApi()
      if (!api) {
        setWorkspace({
          status: "error",
          message: "请在桌面应用中打开工作台。",
        })
        setSaveState("error")
        return false
      }

      workspaceReadyRef.current = false
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
    [applyWorkspace, setSaveState],
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
      if (activeDocumentIdRef.current === activeDocumentId) setHistory({ status: "ready", jobs: result.history })
    } catch (error) {
      if (activeDocumentIdRef.current !== activeDocumentId) return
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
    const api = getDesktopApi()
    if (!api) return
    // oxlint-disable-next-line react/set-state-in-effect -- initial IPC hydration synchronizes React with the main-process remote-service state.
    void loadRemoteServiceState()
    const stopUpdate = api.onUpdateStatus((status) => setUpdateStatus(status))
    const stopDatePolicy = api.onMidtermDatePolicyStatus((status) => setMidtermDatePolicyStatus(status))
    return () => { stopUpdate(); stopDatePolicy() }
  }, [loadRemoteServiceState])

  useEffect(() => {
    if (activePane === "tools" || activePane === "appearance") return
    const view =
      activePane === "profile"
        ? "profile"
        : activePane === "inspection"
          ? "inspection"
          : activeDocumentType
    recordTelemetry({ name: "view_opened", view })
  }, [activeDocumentType, activePane, recordTelemetry])

  useEffect(() => {
    const api = getDesktopApi()
    if (!api) return
    // oxlint-disable-next-line react/set-state-in-effect -- public aggregate is hydrated from the main-process telemetry service.
    void api
      .getAnonymousDocumentCount()
      .then((count) => setGeneratedDocumentCount(count))
      .catch(() => undefined)
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

  useEffect(() => {
    if (!activeDocumentId || activePane !== "inspection") return
    const refreshAfterReturningToApp = () => void refreshHistory()
    window.addEventListener("focus", refreshAfterReturningToApp)
    return () => window.removeEventListener("focus", refreshAfterReturningToApp)
  }, [activeDocumentId, activePane, refreshHistory])

  const saveNow = useCallback(
    (reason: "auto" | "manual" = "auto"): Promise<boolean> => {
      const api = getDesktopApi()
      const activeDocument = documentRef.current
      if (!api || !workspaceReadyRef.current || saving.current) {
        return Promise.resolve(false)
      }

      const versionAtStart = editVersion.current
      const draftAtStart = draftRef.current
      const documentAtStart = activeDocument
      const profileAtStart = profileRef.current
      const expectedRevision = revisionRef.current
      const fingerprints = autosaveFingerprintsForDraft(
        draftAtStart,
        documentTypeFromRecord(documentAtStart?.document_type),
      )
      autosaveVersions.current = reconcileAutosaveFingerprints(
        autosaveVersions.current,
        fingerprints,
      )
      const savePlan = planAutosave(autosaveVersions.current)
      saving.current = true
      setSaveState("saving")

      const task = (async () => {
        try {
          if (savePlan.profile !== null) {
            await api.saveProfileDraft(profileDraftFromDraft(draftAtStart), profileAtStart?.id ?? null)
            let savedProfile = profileAtStart
            const minimumProfileComplete = [draftAtStart.studentName, draftAtStart.studentId, draftAtStart.college, draftAtStart.major].every(value => value.trim())
            const complete = documentAtStart
              ? (isAssessmentDocumentType(documentAtStart.document_type) ? assessmentProfileIsComplete(draftAtStart) : profileIsComplete(draftAtStart))
              : minimumProfileComplete
            if (complete) {
              savedProfile = await api.saveProfile(profileFromDraft(draftAtStart, profileAtStart))
            }
            autosaveVersions.current = acknowledgeAutosave(
              autosaveVersions.current,
              "profile",
              savePlan.profile,
              fingerprints.profile,
            )
            profileRef.current = savedProfile
            if (savedProfile) {
              setSelectedProfileId(savedProfile.id)
              const summary = { id: savedProfile.id, full_name: savedProfile.full_name, student_number: savedProfile.student_number }
              setProfiles(items => [summary, ...items.filter(item => item.id !== summary.id)])
              if (!profileAtStart && documentAtStart) {
                const linked = { ...documentAtStart, profile_id: savedProfile.id }
                documentRef.current = linked
                setDocument(linked)
                setDocuments(items => items.map(item => item.profile_id === null ? { ...item, profile_id: savedProfile.id } : item))
                const page = documentPagesRef.current.active
                if (page) {
                  documentPagesRef.current = { ...documentPagesRef.current, active: { ...page, profile_id: savedProfile.id } }
                  setDocumentPages(documentPagesRef.current)
                }
              }
            }
          }

          if (savePlan.document !== null && documentAtStart) {
            const result = await api.saveDraft({
              documentId: documentAtStart.id,
              content: draftToContent(
                draftAtStart,
                documentTypeFromRecord(documentAtStart?.document_type),
              ),
              expectedRevision,
              reason,
            })
            autosaveVersions.current = acknowledgeAutosave(
              autosaveVersions.current,
              "document",
              savePlan.document,
              fingerprints.document,
            )
            revisionRef.current = result.revision
            const savedDocument = {
              ...documentAtStart,
              profile_id: profileRef.current?.id ?? documentAtStart.profile_id,
              content: draftToContent(draftAtStart, documentTypeFromRecord(documentAtStart?.document_type)),
              current_revision: result.revision,
              saved_at: result.saved_at,
            }
            documentRef.current = savedDocument
            setDocument(savedDocument)
          }
          const savedCurrentRevision = editVersion.current === versionAtStart
          setSaveState(savedCurrentRevision ? "saved" : "dirty")
          const recovered = appliedRecovery.current
          if (savedCurrentRevision && recovered?.documentId === documentAtStart?.id && recovered && removeWorkspaceRecovery(recovered)) {
            appliedRecovery.current = null
            setRecoveryRestored(false)
            setRecovery(null)
          }
          return savedCurrentRevision
        } catch (error) {
          setSaveState(errorHasCode(error, "REVISION_CONFLICT") ? "conflict" : "error")
          return false
        } finally {
          saving.current = false
        }
      })()
      savingPromise.current = task
      void task.then(() => {
        if (savingPromise.current === task) savingPromise.current = null
      })
      return task
    },
    [setSaveState],
  )

  const flushPendingChanges = useCallback(async () => {
    const inFlight = savingPromise.current
    if (inFlight) {
      await inFlight
      if (saveStateRef.current === "error" || saveStateRef.current === "conflict") return false
    }
    if (saveStateRef.current === "conflict") return false
    if (saveStateRef.current === "dirty" || saveStateRef.current === "error") {
      return saveNow("manual")
    }
    return saveStateRef.current === "saved" ||
      (documentRef.current === null && editVersion.current === 0)
  }, [saveNow])

  const runWorkspaceTransition = async (operation: () => Promise<void>) => {
    if (documentTransitioningRef.current || closingRef.current) return
    // Lock synchronously before awaiting either the current save or workspace IPC.
    documentTransitioningRef.current = true
    setDocumentTransitioning(true)
    const task = Promise.resolve().then(operation)
    documentTransitionPromise.current = task
    try {
      await task
    } finally {
      documentTransitioningRef.current = false
      setDocumentTransitioning(false)
      if (documentTransitionPromise.current === task) documentTransitionPromise.current = null
    }
  }

  const prepareForDocumentChange = async () => {
    if (!getDesktopApi() || workspace.status !== "ready" || exportState.status === "exporting") return false
    return flushPendingChanges()
  }

  const selectStudentProfile = async (profileId: string) => {
    if (selectedProfileId === profileId || documentTransitioningRef.current || closingRef.current) return
    try {
      await runWorkspaceTransition(async () => {
        const api = getDesktopApi()
        if (!api || !(await prepareForDocumentChange())) {
          throw new Error("当前档案或草稿尚未保存，已留在原档案。")
        }
        const snapshot = await api.selectProfile(profileId)
        await applyWorkspace(snapshot)
        setPreviewOpen(false)
        setActivePane("profile")
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "档案切换失败，请重试。")
    }
  }

  const openCreateProfile = () => {
    setNewStudent({ full_name: "", student_number: "", college: "", major: "" })
    setCreateProfileError(null)
    setCreateProfileOpen(true)
  }

  const createStudentProfile = async () => {
    if (documentTransitioningRef.current || closingRef.current) return
    setCreateProfileError(null)
    try {
      await runWorkspaceTransition(async () => {
        const api = getDesktopApi()
        if (!api || !(await prepareForDocumentChange())) {
          throw new Error("当前档案或草稿尚未保存，暂时无法新建档案。")
        }
        const fields = {
          full_name: newStudent.full_name.trim(), student_number: newStudent.student_number.trim(),
          college: newStudent.college.trim(), major: newStudent.major.trim(),
        }
        if (Object.values(fields).some(value => !value)) {
          setCreateProfileError("请填写姓名、学号、学院和专业。")
          return
        }
        await applyWorkspace(await api.createProfile(fields))
        setPreviewOpen(false)
        setActivePane("profile")
        setCreateProfileOpen(false)
      })
    } catch (error) {
      setCreateProfileError(error instanceof Error ? error.message : "新建档案失败，请重试。")
    }
  }

  const changeDeletedProfile = async (action: "delete" | "restore", profileId: string) => {
    if (documentTransitioningRef.current || closingRef.current) return
    try {
      await runWorkspaceTransition(async () => {
        const api = getDesktopApi()
        if (!api || !(await prepareForDocumentChange())) {
          throw new Error("当前档案或草稿尚未保存，请保存后重试。")
        }
        const snapshot = await (action === "delete" ? api.deleteProfile(profileId) : api.restoreProfile(profileId))
        await applyWorkspace(snapshot)
        setPreviewOpen(false)
        setActivePane("profile")
        setProfileToDelete(null)
        setDeletedProfilesOpen(false)
        toast.success(action === "delete" ? "档案已移到「已删除档案」" : "已恢复档案")
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败，请重试。")
    }
  }

  const selectDocumentFile = async (documentId: string) => {
    if (documentTransitioningRef.current || closingRef.current) return
    if (documentId === activeDocumentId) {
      setActivePane("document")
      return
    }
    try {
      await runWorkspaceTransition(async () => {
        const api = getDesktopApi()
        if (!api || !(await prepareForDocumentChange())) {
          throw new Error("当前内容尚未保存，暂时无法切换文档。")
        }
        const snapshot = await api.selectDocument(documentId)
        await applyWorkspace(snapshot)
        setActivePane("document")
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文档切换失败，请重试。")
    }
  }

  const createDocumentFile = async (request: CreateDocumentRequest) => {
    await runWorkspaceTransition(async () => {
      const api = getDesktopApi()
      if (!api || !(await prepareForDocumentChange())) {
        throw new Error("当前内容尚未保存，暂时无法新建文档。")
      }
      const created = await api.createDocument({
        profile_id: request.profileId,
        document_type: request.type,
        template_version:
          request.type === "thesis" ? "0.1.0-authoring" :
          request.type === "task_book"
            ? "0.2+66c968c"
            : request.type === "midterm"
              ? "0.3+66c968c"
              : "0.1.0-dev.1",
        schema_version: request.type === "proposal" ? "0.2" : "0.1",
        title: request.title,
        source_document_id: request.sourceDocumentId,
      })
      const snapshot = await api.selectDocument(created.id)
      await applyWorkspace(snapshot, undefined, request.type === "proposal" && !request.sourceDocumentId)
      setActivePane("document")
    })
  }

  const runDocumentMutation = async (
    operation: (api: NonNullable<ReturnType<typeof getDesktopApi>>) => Promise<WorkspaceSnapshot>,
  ) => {
    await runWorkspaceTransition(async () => {
      const api = getDesktopApi()
      if (!api || !(await prepareForDocumentChange())) {
        throw new Error("当前内容尚未保存，暂时无法执行此操作。")
      }
      const snapshot = await operation(api)
      await applyWorkspace(snapshot)
    })
  }

  const reloadWorkspace = async () => {
    try {
      await runWorkspaceTransition(async () => {
        const current = documentRef.current
        if (current && saveStateRef.current === "conflict") {
          const retained: WorkspaceRecovery = {
            version: 1,
            documentId: current.id,
            documentType: documentTypeFromRecord(current.document_type),
            capturedAt: new Date().toISOString(),
            content: draftToContent(draftRef.current, documentTypeFromRecord(current.document_type)),
            profileDraft: profileDraftFromDraft(draftRef.current),
          }
          writeWorkspaceRecovery(retained)
          setRecovery(retained)
        }
        await openWorkspace("persistent")
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法保留当前草稿，已取消重新载入。")
    }
  }

  const restoreRecovery = () => {
    const current = documentRef.current
    if (!current || !recovery || recovery.documentId !== current.id ||
      documentTransitioningRef.current || closingRef.current || saving.current || saveStateRef.current === "conflict") return
    const restored = draftFromRecords(profileRef.current, recovery.profileDraft, { ...current, content: recovery.content })
    const fingerprints = autosaveFingerprintsForDraft(restored, documentTypeFromRecord(current.document_type))
    draftRef.current = restored
    setDraft(restored)
    editVersion.current += 1
    for (const scope of ["profile", "document"] as const) {
      if (fingerprints[scope] !== autosaveVersions.current[scope].persistedFingerprint) {
        autosaveVersions.current = markAutosaveEdited(autosaveVersions.current, scope)
      }
    }
    appliedRecovery.current = recovery
    setRecoveryRestored(true)
    setPreviewState(currentPreview => currentPreview.status === "ready" ? { ...currentPreview, stale: true } : currentPreview)
    setSaveState("dirty")
  }

  const dismissRecovery = () => {
    if (!recovery || appliedRecovery.current || documentTransitioningRef.current || closingRef.current) return
    if (removeWorkspaceRecovery(recovery)) setRecovery(null)
    else toast.error("无法移除保留副本，请稍后再试。")
  }

  useEffect(() => {
    const api = getDesktopApi()
    if (!api?.onCloseRequest) return
    return api.onCloseRequest((requestId) => {
      if (!closeSavePromise.current) {
        closingRef.current = true
        setClosing(true)
        closeSavePromise.current = (async () => {
          await documentTransitionPromise.current?.catch(() => undefined)
          const documentSaved = await flushPendingChanges()
          const toolsSaved = flushLocalDrafts()
          return toolsSaved && documentSaved
        })()
      }
      const pending = closeSavePromise.current
      void pending.then(async (saved) => {
        if (closeSavePromise.current === pending) closeSavePromise.current = null
        const conflict = saveStateRef.current === "conflict"
        if (!saved) toast.error(conflict
          ? "草稿存在版本冲突，请处理后再关闭窗口。"
          : "草稿尚未保存，窗口已保留，请重试保存后再关闭。")
        const completion = await api.completeCloseRequest({
          requestId,
          outcome: saved ? "saved" : "failed",
          ...(saved ? {} : { reason: conflict ? "conflict" as const : "save_failed" as const }),
        })
        if (!saved || !completion.accepted) {
          closingRef.current = false
          setClosing(false)
        }
      }).catch(() => {
        closeSavePromise.current = null
        closingRef.current = false
        setClosing(false)
        toast.error("无法确认关闭状态，窗口中的内容仍保留。")
      })
    })
  }, [flushPendingChanges])

  useEffect(() => {
    if (saveState !== "dirty" || workspace.status !== "ready") return
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void (async () => {
        await savingPromise.current
        if (!cancelled && saveStateRef.current === "dirty") await saveNow("auto")
      })()
    }, 700)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [draft, saveNow, saveState, workspace.status])

  const commitDraftEdit = (update: (current: Draft) => Draft, scope: "profile" | "document") => {
    if (documentTransitioningRef.current || closingRef.current) return
    const next = update(draftRef.current)
    draftRef.current = next
    setDraft(next)
    setPreviewState(current => current.status === "ready" ? { ...current, stale: true } : current)
    editVersion.current += 1
    autosaveVersions.current = markAutosaveEdited(autosaveVersions.current, scope)
    setSaveState("dirty")
  }

  const updateDraft = (field: TextDraftField, value: string) => {
    commitDraftEdit((current) => {
      const next = { ...current, [field]: value }
      if (field === "studentId" && value !== current.studentId) {
        const inferred = inferStudentNumberAcademics(value)
        if (!inferred) return next
        const college = inferred.college ?? current.college
        const collegeOption = findCollegeOption(college)
        const major = inferred.major ?? (
          inferred.college && !collegeOption?.majors.some(option => option.major === current.major.trim())
            ? ""
            : current.major
        )
        const academicPathChanged = college.trim() !== current.college.trim() || major.trim() !== current.major.trim()
        const classFitsNewPath = collegeOption?.majors
          .find(option => option.major === major.trim())
          ?.classes.includes(normalizeAcademicClassLabel(current.className))
        return {
          ...next,
          graduationCohort: inferred.graduationCohort,
          college,
          major,
          className: academicPathChanged && !classFitsNewPath ? "" : current.className,
        }
      }
      if (field === "referencesBibtex") {
        const references = cachedReferencesFromBibtex(value, PROPOSAL_REFERENCE_RULES)
        return references === null ? next : { ...next, references }
      }
      if (field === "taskReferencesBibtex") {
        const taskReferences = cachedReferencesFromBibtex(value, TASK_BOOK_REFERENCE_RULES)
        return taskReferences === null ? next : { ...next, taskReferences }
      }
      return next
    }, PROFILE_FIELDS.has(field) ? "profile" : "document")
  }

  const updateStructuredBody = (field: StructuredDraftField, value: StructuredBodyValue) => {
    commitDraftEdit(current => ({ ...current, [field]: value }), field === "title" ? "profile" : "document")
  }

  const updateDirectory = (value: OutlineEditorItem[]) => {
    commitDraftEdit(current => ({ ...current, directory: value }), "document")
  }

  const updateDirectoryNumberingStyle = (value: OutlineNumberingStyle) => {
    commitDraftEdit(current => ({
      ...current,
      directoryNumberingStyle: value,
      directory: numberOutlineItems(current.directory, value),
    }), "document")
  }

  const updateAssessment = (value: AssessmentDraft) => {
    commitDraftEdit(current => ({ ...current, assessment: value }), "document")
  }

  const updateTaskSchedule = (value: TaskScheduleEditorItem[]) => {
    commitDraftEdit(current => ({ ...current, taskSchedule: value }), "document")
  }

  const checkContent = async (onDiagnosticCase?: (id: string) => void): Promise<boolean> => {
    if (activeDocumentType === "thesis") return false
    const api = getDesktopApi()
    if (!api || !document || workspace.status !== "ready") return false
    const documentIdAtStart = document.id
    const versionAtStart = editVersion.current
    setProfileValidationRequested(true)
    if (saveStateRef.current === "conflict") {
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "REVISION_CONFLICT",
      })
      toast.error("草稿存在版本冲突，请重新载入后再检查或预览。")
      return false
    }
    if (
      saveStateRef.current === "loading" ||
      saveStateRef.current === "saving"
    ) {
      return false
    }
    if (document.profile_id === null && (profiles.length || deletedProfiles.length)) {
      setPreviewOpen(false)
      toast.error("这份旧草稿没有档案。请新建同类文档，在「使用档案」选人，在「初始内容」选这份草稿。")
      return false
    }
    if (!(isAssessmentDocumentType(activeDocumentType) ? assessmentProfileIsComplete(draft) : profileIsComplete(draft))) {
      const message = isAssessmentDocumentType(activeDocumentType)
        ? "请先打开左侧“档案与基本信息”，补全姓名、学号、学院和专业。"
        : "请先打开左侧“档案与基本信息”，补全姓名、学号、毕业届别、学院、专业、班级、指导教师和职称。"
      setActivePane("profile")
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "PROFILE_INCOMPLETE",
      })
      toast.error(message)
      return false
    }
    const thesisTitle = structuredBodyPlainText(draft.title).trim()
    if (!thesisTitle || thesisTitle.length > THESIS_TITLE_MAX_LENGTH) {
      const message = !thesisTitle
        ? "请先打开左侧“档案与基本信息”，填写论文题目。"
        : `基本信息中的论文题目最多 ${THESIS_TITLE_MAX_LENGTH} 个字符。`
      navigateToCheck({ pane: "profile", selector: '[aria-label="中文题目"]' })
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "THESIS_TITLE_INVALID",
      })
      toast.error(message)
      return false
    }
    if (
      activeDocumentType === "task_book" &&
      graduationYearFromCohort(draft.graduationCohort) === null
    ) {
      const message =
        "毕业届别须包含四位年份，请在“基本信息”中修改，例如“2026届”。"
      navigateToCheck({ pane: "profile", selector: "#graduationCohort" })
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "GRADUATION_YEAR_MISSING",
      })
      toast.error(message)
      return false
    }
    if (
      saveStateRef.current === "dirty" ||
      saveStateRef.current === "error"
    ) {
      const saved = await saveNow("manual")
      if (!saved || !isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        if (
          activeDocumentIdRef.current === documentIdAtStart &&
          editVersion.current !== versionAtStart
        ) {
          toast.info("保存期间内容发生了变化，请等待当前内容保存后重新检查。")
        }
        return false
      }
    }
    if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
      return false
    }
    try {
      const result = await api.checkDocument(documentIdAtStart)
      if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        if (activeDocumentIdRef.current === documentIdAtStart) {
          toast.info("检查期间内容发生了变化，本次检查结果已丢弃。")
        }
        return false
      }
      const passed = result.checks.every((check) => check.status === "pass")
      const failedCheck = result.checks.find((check) => check.status === "fail")
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: passed ? "success" : "failure",
        ...(passed
          ? {}
          : { errorCode: failedCheck?.code ?? "VALIDATION_FAILED" }),
      })
      if (passed) {
        toast.success("内容检查通过。")
      } else {
        const target = failedCheck
          ? checkNavigationTarget(activeDocumentType, failedCheck)
          : null
        if (target) navigateToCheck(target)
        if (result.diagnostic_case_id) onDiagnosticCase?.(result.diagnostic_case_id)
        toast.error(failedCheck?.message ?? "内容检查未通过。")
      }
      return passed
    } catch (error) {
      if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        return false
      }
      const caseId = diagnosticCaseId(error)
      if (caseId) onDiagnosticCase?.(caseId)
      const message = error instanceof Error ? error.message : "内容检查失败。"
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: telemetryErrorCode(error),
      })
      toast.error(message)
      return false
    }
  }

  const generatePreview = async () => {
    if (activeDocumentType === "thesis") return
    if (activeDocumentType === "midterm" && !midtermDateIsAllowed(draft.checkDate, midtermDateRule)) {
      setPreviewState({ status: "error", message: "请重新选择有效的检查日期。" })
      return
    }
    const api = getDesktopApi()
    if (
      !api ||
      !document ||
      activePane === "profile" ||
      previewState.status === "checking" ||
      previewState.status === "generating" ||
      exportState.status === "exporting" ||
      saveStateRef.current === "loading" ||
      saveStateRef.current === "saving" ||
      saveStateRef.current === "conflict"
    ) {
      return
    }
    const documentIdAtStart = document.id
    const versionAtStart = editVersion.current
    setPreviewState({ status: "checking" })
    let caseId: string | undefined
    const passed = await checkContent(id => { caseId = id })
    if (
      !passed ||
      !isCurrentSavedRevision(documentIdAtStart, versionAtStart)
    ) {
      if (activeDocumentIdRef.current === documentIdAtStart) {
        setPreviewState({
          status: "error",
          caseId,
          message:
            editVersion.current === versionAtStart
              ? "内容检查未通过，请根据页面提示修正后重试。"
              : "检查期间内容发生了变化，请等待当前内容保存后重试。",
        })
      }
      recordTelemetry({
        name: "document_action",
        action: "preview",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "PRECHECK_FAILED",
      })
      return
    }
    setPreviewState({ status: "generating" })
    try {
      const result = await api.generatePreview({
        requestId: newRequestId(),
        documentId: documentIdAtStart,
      })
      if (activeDocumentIdRef.current !== documentIdAtStart) return
      const stale = !isCurrentSavedRevision(documentIdAtStart, versionAtStart)
      setPreviewState({ status: "ready", result, stale })
      recordTelemetry({
        name: "document_action",
        action: "preview",
        documentType: activeDocumentType,
        outcome: stale ? "failure" : "success",
        ...(stale ? { errorCode: "RESULT_STALE" } : {}),
      })
      if (stale) toast.info("预览已生成，但内容随后发生变化，请重新生成。")
      else showPreviewAcceptanceBoundary()
    } catch (error) {
      if (activeDocumentIdRef.current !== documentIdAtStart) return
      if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        setPreviewState({ status: "idle" })
        return
      }
      const message = error instanceof Error ? error.message : "排版预览生成失败。"
      setPreviewState({ status: "error", message, caseId: diagnosticCaseId(error) })
      recordTelemetry({
        name: "document_action",
        action: "preview",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: telemetryErrorCode(error),
      })
      toast.error(message)
    }
  }

  const installTemplate = async () => {
    const api = getDesktopApi()
    if (!api || templateInstalling) return
    setTemplateInstalling(true)
    try {
      const installed = await api.installTemplatePack(activeDocumentType)
      if (!installed) {
        recordTelemetry({
          name: "document_action",
          action: "template_sync",
          documentType: activeDocumentType,
          outcome: "cancelled",
        })
        return
      }
      toast.success(
        installed.status === "already_current"
          ? `模板已是最新版本 ${installed.version}。`
          : `模板已更新至 ${installed.version}。`,
      )
      setPreviewState((current) =>
        current.status === "ready" &&
        current.result.template.pack_sha256 !== installed.pack_sha256
          ? { ...current, stale: true }
          : current,
      )
      await refreshEnvironment()
      recordTelemetry({
        name: "document_action",
        action: "template_sync",
        documentType: activeDocumentType,
        outcome: "success",
      })
    } catch (error) {
      recordTelemetry({
        name: "document_action",
        action: "template_sync",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: telemetryErrorCode(error),
      })
      toast.error(error instanceof Error ? error.message : "模板安装失败。")
    } finally {
      setTemplateInstalling(false)
    }
  }

  const revealArtifact = async (artifactId: string) => {
    const api = getDesktopApi()
    if (!api) return
    try {
      await api.revealExportArtifact(artifactId)
      toast.success("已打开文件所在位置。")
    } catch (error) {
      await refreshHistory()
      toast.error(error instanceof Error ? error.message : "无法打开文件所在位置。")
    }
  }

  const deleteHistoryRecord = async (exportId: string) => {
    const api = getDesktopApi()
    if (!api || !activeDocumentId) return false
    try {
      await api.deleteExportHistory({ documentId: activeDocumentId, exportId })
      setHistory((current) => ({
        status: "ready",
        jobs: current.jobs.filter((job) => job.export_id !== exportId),
      }))
      toast.success("已删除导出记录，本地文件未受影响。")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出记录删除失败。")
      return false
    }
  }

  const executeExport = async (pending: PendingExport) => {
    const api = getDesktopApi()
    if (!api) return
    const previewMatchesPending =
      previewState.status === "ready" &&
      !previewState.stale &&
      previewState.result.document_id === pending.documentId &&
      previewState.result.input_sha256 === pending.previewInputSha256 &&
      previewState.result.template.pack_sha256 === pending.previewTemplateSha256
    if (
      !isCurrentSavedRevision(pending.documentId, pending.editVersion) ||
      !previewMatchesPending
    ) {
      if (activeDocumentIdRef.current === pending.documentId) {
        setPreviewState((current) =>
          current.status === "ready" ? { ...current, stale: true } : current,
        )
        toast.error("内容或模板已经变化，请重新生成排版预览后再导出。")
      }
      return
    }
    setExportState({
      status: "exporting",
      formats: pending.formats,
      requestId: pending.requestId,
      cancelRequested: false,
    })
    try {
      exportFeedback.reset("export")
      const receipt = await api.exportDocument({
        requestId: pending.requestId,
        documentId: pending.documentId,
        previewId: pending.previewId,
        outputDirectory: pending.outputDirectory,
        formats: pending.formats,
        overwriteConfirmed: false,
        preflightToken: pending.preflightToken,
      })
      setExportState({ status: "succeeded", receipt })
      exportFeedback.complete("export")
      recordTelemetry({
        name: "document_action",
        action: "export",
        documentType: activeDocumentType,
        outcome: "success",
        formatCount: pending.formats.length,
      })
      if (pending.documentType !== "thesis") void api
        .recordDocumentCompletion({
          documentId: pending.documentId,
          documentType: pending.documentType,
        })
        .then((result) => {
          if (result.total !== null) {
            setGeneratedDocumentCount(result.total)
          } else if (result.recorded) {
            setGeneratedDocumentCount((current) =>
              current === null ? null : current + 1,
            )
          }
        })
        .catch(() => undefined)
      toast.success(
        `已导出 ${receipt.artifacts
          .map((artifact) => artifact.format.toUpperCase())
          .join("、")}。`,
      )
      celebrateExportSuccess()
      await refreshHistory()
    } catch (error) {
      if (telemetryErrorCode(error) === "PREVIEW_STALE") {
        setPreviewState(current => current.status === "ready" &&
          current.result.document_id === pending.documentId && current.result.preview_id === pending.previewId
          ? { ...current, stale: true } : current)
      }
      const cancelled = errorHasCode(error, "EXPORT_CANCELLED")
      const message = cancelled
        ? "已取消导出。"
        : error instanceof Error
          ? error.message
          : "导出失败。"
      setExportState({ status: "error", message, caseId: diagnosticCaseId(error) })
      recordTelemetry({
        name: "document_action",
        action: "export",
        documentType: activeDocumentType,
        outcome: cancelled ? "cancelled" : "failure",
        ...(cancelled ? {} : { errorCode: telemetryErrorCode(error) }),
        formatCount: pending.formats.length,
      })
      if (cancelled) toast.info(message)
      else toast.error(message)
      await refreshHistory()
    }
  }

  const startExport = async (formats: ExportFormat[]) => {
    const api = getDesktopApi()
    if (!api || !document || exportState.status === "exporting") return
    if (
      previewState.status !== "ready" ||
      previewState.stale ||
      previewState.result.document_id !== document.id
    ) {
      toast.error("请先生成当前内容的排版预览，再执行导出。")
      return
    }
    const documentIdAtStart = document.id
    const versionAtStart = editVersion.current
    const previewAtStart = previewState.result
    const passed = await checkContent()
    if (
      !passed ||
      !isCurrentSavedRevision(documentIdAtStart, versionAtStart)
    ) {
      return
    }
    const outputDirectory = await api.chooseExportDirectory()
    if (!outputDirectory) {
      recordTelemetry({
        name: "document_action",
        action: "export",
        documentType: activeDocumentType,
        outcome: "cancelled",
        formatCount: formats.length,
      })
      return
    }
    if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
      setPreviewState((current) =>
        current.status === "ready" ? { ...current, stale: true } : current,
      )
      toast.error("内容已经变化，请重新生成排版预览后再导出。")
      return
    }
    try {
      const preflight = await api.preflightExport({
        documentId: documentIdAtStart,
        previewId: previewAtStart.preview_id,
        formats,
        outputDirectory,
      })
      if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        setPreviewState((current) =>
          current.status === "ready" ? { ...current, stale: true } : current,
        )
        toast.error("内容已经变化，请重新生成排版预览后再导出。")
        return
      }
      if (
        preflight.input_sha256 !== previewAtStart.input_sha256 ||
        preflight.template.pack_sha256 !== previewAtStart.template.pack_sha256
      ) {
        setPreviewState((current) =>
          current.status === "ready" ? { ...current, stale: true } : current,
        )
        toast.error("内容或模板已在预览后变化，请重新生成排版预览。")
        return
      }
      const pending: PendingExport = {
        requestId: newRequestId(),
        documentId: documentIdAtStart,
        documentType: activeDocumentType,
        previewId: previewAtStart.preview_id,
        editVersion: versionAtStart,
        previewInputSha256: previewAtStart.input_sha256,
        previewTemplateSha256: previewAtStart.template.pack_sha256,
        outputDirectory,
        formats: preflight.targets.map((target) => target.format),
        preflightToken: preflight.preflight_token,
      }
      await executeExport(pending)
    } catch (error) {
      if (
        activeDocumentIdRef.current === documentIdAtStart &&
        !isCurrentSavedRevision(documentIdAtStart, versionAtStart)
      ) {
        setPreviewState((current) =>
          current.status === "ready" ? { ...current, stale: true } : current,
        )
        toast.error("内容已经变化，请重新生成排版预览后再导出。")
        return
      }
      if (telemetryErrorCode(error) === "PREVIEW_STALE") {
        setPreviewState(current => current.status === "ready" &&
          current.result.document_id === documentIdAtStart && current.result.preview_id === previewAtStart.preview_id
          ? { ...current, stale: true } : current)
      }
      const message = error instanceof Error ? error.message : "导出预检失败。"
      setExportState({ status: "error", message, caseId: diagnosticCaseId(error) })
      recordTelemetry({
        name: "document_action",
        action: "export",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: telemetryErrorCode(error),
        formatCount: formats.length,
      })
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

  const downloadUpdate = async () => {
    const api = getDesktopApi()
    if (!api) return
    try {
      setUpdateStatus(await api.downloadUpdate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法下载更新，请稍后重试。")
    }
  }

  const revealDownloadedUpdate = async () => {
    const api = getDesktopApi()
    if (!api) return
    try {
      await api.revealDownloadedUpdate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法显示更新文件。")
    }
  }

  const openReleaseHelp = async () => {
    const api = getDesktopApi()
    if (!api) return
    try {
      await api.openReleaseHelp()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开使用说明。")
    }
  }

  const workspaceDisabled = workspace.status !== "ready" || documentTransitioning || closing
  const templateCheck = activeDocumentType === "thesis"
    ? undefined
    : activeTemplateCheck(environment, activeDocumentType)
  const templateReady = templateCheck?.status === "pass"
  const environmentFailure =
    environment.status === "ready"
      ? environment.result.checks.find(
          (check) => check.required && check.status === "fail",
        )
      : undefined
  const environmentReady =
    environment.status === "ready" && environment.result.ready

  // Surface the setup guide once per installation. A fresh Mac without MacTeX would otherwise only
  // learn about the requirement when the first preview fails.
  useEffect(() => {
    if (environment.status !== "ready" || environment.result.ready) return
    if (environmentOnboardingIsComplete()) return
    completeEnvironmentOnboarding()
    setEnvironmentGuideOpen(true)
  }, [environment])
  const previewReady =
    previewState.status === "ready" &&
    !previewState.stale &&
    previewState.result.document_id === document?.id
  const previewBusy =
    previewState.status === "checking" || previewState.status === "generating"
  const previewTriggerDisabled =
    workspaceDisabled ||
    activeDocumentType === "thesis" ||
    activePane !== "document" ||
    !document ||
    saveState === "loading" ||
    saveState === "saving" ||
    saveState === "conflict" ||
    exportState.status === "exporting"
  const previewGenerationDisabled =
    previewTriggerDisabled || !environmentReady || !templateReady
  const draftExportReady = draftIsExportReady(draft, activeDocumentType, midtermDateRule)
  const exportDisabled =
    workspaceDisabled ||
    activeDocumentType === "thesis" ||
    activePane !== "document" ||
    !document ||
    saveState !== "saved" ||
    !environmentReady ||
    !templateReady ||
    !draftExportReady ||
    !previewReady ||
    exportState.status === "exporting"
  const exportDisabledReason = activeDocumentType === "thesis"
    ? "当前文档暂不支持预览和导出"
    : !environmentReady
    ? environmentFailure?.message ?? "请先修复本机文档环境"
    : !templateReady
      ? "请先在左侧“导出记录”中选择可用模板"
      : !previewReady
        ? "请先生成当前内容的排版预览"
        : draftExportReady
          ? "选择导出格式"
          : activeDocumentType === "task_book"
            ? "请补全任务书正文、进度安排、参考文献和选题信息，并确认毕业届别含四位年份"
            : activeDocumentType === "midterm"
              ? "请先填写全部必填项、有效目录、研究内容和进展情况"
              : "请先填写全部必填项，并确保选题意义至少有两个段落"

  const openPreviewAndExport = () => {
    if (activeDocumentType === "thesis") return
    previewCheckTarget.current = null
    setPreviewPanelInitialWidth(previewDrawerWidth)
    setPreviewOpen(true)
    if (previewReady) {
      showPreviewAcceptanceBoundary()
    } else if (!previewBusy && !previewGenerationDisabled) {
      void generatePreview()
    }
  }

  const openToolLink = async (toolId: ToolLinkId) => {
    const api = getDesktopApi()
    if (!api) {
      toast.error("请在桌面应用中使用此功能。")
      return
    }
    try {
      await api.openToolLink(toolId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开外部工具。")
    }
  }

  const releaseControl = "control" in updateStatus ? updateStatus.control : undefined
  const updateDownloadProgress = updateStatus.state === "downloading" ? (
    <Progress value={Math.floor(updateStatus.downloadedBytes / updateStatus.sizeBytes * 100)}>
      <ProgressLabel className="sr-only">下载进度</ProgressLabel>
      <span className="text-sm text-muted-foreground tabular-nums">
        {(updateStatus.downloadedBytes / 1_000_000).toFixed(1)} MB / {(updateStatus.sizeBytes / 1_000_000).toFixed(1)} MB
      </span>
      <ProgressValue />
    </Progress>
  ) : null
  const releaseHasNewVersion =
    updateStatus.state === "available" || updateStatus.state === "downloading" || updateStatus.state === "downloaded"
  const releaseRequiresUpdate = Boolean(
    releaseControl?.requiresUpgrade ||
      (releaseControl?.updatePolicy === "required" && releaseHasNewVersion),
  )
  const releaseIsRetired = releaseControl?.serviceStatus === "retired"
  const releaseBlocking = Boolean(
    releaseIsRetired ||
      releaseRequiresUpdate ||
      (releaseControl?.announcement && !releaseControl.announcement.dismissible),
  )
  const releaseAnnouncement = releaseControl?.announcement
  const releaseNoticeOpen = Boolean(
    !releaseBlocking &&
      ((releaseControl?.serviceStatus === "maintenance" && !maintenanceDismissed) ||
        (releaseAnnouncement && releaseAnnouncement.id !== dismissedAnnouncementId)),
  )

  const selectedProfile = profiles.find(item => item.id === selectedProfileId)
  const profileActionsDisabled = workspaceDisabled || previewBusy || exportState.status === "exporting"
  const hasProfileRecords = profiles.length > 0 || deletedProfiles.length > 0
  const isDetachedScope = hasProfileRecords && selectedProfileId === null
  const needsDocumentProfile = isDetachedScope && document?.profile_id === null

  const profileActions = (
    <div className="flex flex-wrap items-center gap-2">
      {profiles.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button variant="outline" aria-label="选择要编辑的档案" disabled={profileActionsDisabled} />
          }>
            <span className="max-w-48 truncate">{selectedProfile?.full_name ?? "选择档案"}</span>
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {profiles.map(item => (
              <DropdownMenuItem key={item.id} disabled={item.id === selectedProfileId} onClick={() => void selectStudentProfile(item.id)}>
                <span className="min-w-0 truncate">{item.full_name} · {item.student_number}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button variant="outline" onClick={openCreateProfile} disabled={profileActionsDisabled}>新建档案</Button>
      {selectedProfile || deletedProfiles.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="管理档案" disabled={profileActionsDisabled} />}>
            <AnimatedActionIcon icon={EllipsisIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {deletedProfiles.length ? <DropdownMenuItem onClick={() => setDeletedProfilesOpen(true)}>已删除档案</DropdownMenuItem> : null}
            {selectedProfile ? (
              <DropdownMenuItem variant="destructive" onClick={() => setProfileToDelete(selectedProfile)}>删除当前档案</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )

  const documentActions = document && activeDocumentType !== "thesis" ? (
    <Button
      size={isMobile ? "icon" : "default"}
      aria-label="预览&导出"
      title="预览&导出"
      className="ml-auto"
      onClick={openPreviewAndExport}
      disabled={previewTriggerDisabled}
    >
      {previewBusy ? (
        <ThinkingOrb state="solving" size={20} aria-label="正在生成预览" />
      ) : (
        <AnimatedActionIcon icon={FileTextIconAnimated} />
      )}
      {isMobile ? null : <span>预览&导出</span>}
    </Button>
  ) : null

  const editor =
    activePane === "profile" ? (
      <StudentProfileEditor
        key={selectedProfileId ?? "unassigned"}
        profileActions={profileActions}
        assessmentMode={isAssessmentDocumentType(activeDocumentType)}
        unassigned={isDetachedScope}
        unassignedHelp={profiles.length ? "选择一份档案查看或编辑基本信息。" : "可新建档案，也可恢复已删除的档案。"}
        validationRequested={profileValidationRequested}
        draft={draft}
        onChange={updateDraft}
        onStructuredBodyChange={updateStructuredBody}
        disabled={workspaceDisabled}
        workspace={workspace}
      />
    ) : (
      <DocumentEditor
        validationRequested={profileValidationRequested}
        needsDocumentProfile={needsDocumentProfile}
        documentId={document?.id ?? ""}
        documentType={activeDocumentType}
        activeSection={activeSection}
        viewState={activeDocumentViewState}
        onViewStateChange={updateActiveDocumentViewState}
        draft={draft}
        midtermDateRule={midtermDateRule}
        onChange={updateDraft}
        onStructuredBodyChange={updateStructuredBody}
        onDirectoryChange={updateDirectory}
        onDirectoryNumberingStyleChange={updateDirectoryNumberingStyle}
        onTaskScheduleChange={updateTaskSchedule}
        onAssessmentChange={updateAssessment}
        disabled={workspaceDisabled}
        workspace={workspace}
        saveState={saveState}
        onRetryLoad={() => void reloadWorkspace()}
        retryLoadDisabled={documentTransitioning || closing}
        onRetrySave={() => void saveNow("manual")}
        recoveryAvailable={recovery !== null && recovery.documentId === document?.id}
        recoveryRestored={recoveryRestored}
        onRestoreRecovery={restoreRecovery}
        onDismissRecovery={dismissRecovery}
        toolbarActions={documentActions}
      />
    )

  const inspectionPanel = (
    <InspectionPanel
      environment={environment}
      templateCheck={templateCheck}
      thesisTemplatePending={activeDocumentType === "thesis"}
      onRefresh={refreshEnvironment}
      onOpenEnvironmentGuide={() => setEnvironmentGuideOpen(true)}
      onInstallTemplate={() => void installTemplate()}
      templateInstalling={templateInstalling}
      exportState={exportState}
      onCancelExport={() => void cancelExport()}
      history={history}
      onRefreshHistory={() => void refreshHistory()}
      onRevealArtifact={(artifactId) => void revealArtifact(artifactId)}
      onDeleteHistory={deleteHistoryRecord}
    />
  )

  const sectionNavigation = (
    <DocumentSectionNav
      sections={sections}
      activeSection={activeSection}
      animationContextKey={document?.id ?? activeDocumentType}
      showSidebarToggle
      onSectionChange={(sectionId) =>
        setActiveSections((current) => ({
          ...current,
          [activeDocumentType]: sectionId,
        }))
      }
    />
  )

  const thesisSectionNavigation = (
    <DocumentSectionNav
      sections={thesisToolOptions satisfies DocumentSectionOption[]}
      activeSection={activeThesisTool}
      animationContextKey="thesis-tools"
      showSidebarToggle
      showCompletion={false}
      onSectionChange={(toolId) => {
        if (!closingRef.current) setActiveThesisTool(toolId as ThesisToolId)
      }}
    />
  )

  const previewPanel = (
    <PaginatedPreviewPanel
      activePane={activePane}
      documentType={activeDocumentType}
      previewState={previewState}
      blockedMessage={
        environment.status === "error"
          ? "文档服务暂时无法连接，请在“导出记录”中查看环境检查。"
          : environmentFailure
            ? environmentFailure.message
          : environment.status === "ready" && !templateReady
            ? templateCheck?.message ?? "当前文档模板不可用，请重新选择模板。"
            : undefined
      }
      disabled={
        previewGenerationDisabled
      }
      onGenerate={() => void generatePreview()}
      onOpenEnvironmentGuide={environment.status === "error" || environmentFailure
        ? () => setEnvironmentGuideOpen(true)
        : undefined}
    />
  )

  const mainPanel =
    activePane === "inspection" ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{inspectionPanel}</div>
        <SaveStatusFooter state={saveState} />
      </div>
    ) : activePane === "tools" ? (
      <ToolDirectory onOpenTool={openToolLink} />
    ) : activePane === "appearance" ? (
      <AppearanceSettings />
    ) : activePane === "thesis_tools" ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1" inert={closing}>
          <ThesisToolsWorkbench
            activeTool={activeThesisTool}
            onSaveStateChange={handleThesisToolSaveStateChange}
          />
        </div>
        <SaveStatusFooter state={thesisToolSaveStates[activeThesisTool]} />
      </div>
    ) : (
      editor
    )

  return (
    <SidebarProvider
      className="h-svh min-h-0 overflow-hidden"
      style={
        {
          "--sidebar-width": "14rem",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <Dialog open={createProfileOpen} onOpenChange={open => { if (!documentTransitioningRef.current) setCreateProfileOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建档案</DialogTitle>
            <DialogDescription>档案中的姓名、学号等信息会用于关联的文档。</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void createStudentProfile() }}>
            {([
              ["full_name", "姓名", 100], ["student_number", "学号", 64],
              ["college", "学院", 200], ["major", "专业", 200],
            ] as const).map(([field, label, maximum]) => (
              <div key={field} className="grid gap-2">
                <Label htmlFor={`new-student-${field}`}>{label}</Label>
                <Input id={`new-student-${field}`} required maxLength={maximum} disabled={documentTransitioning}
                  value={newStudent[field]} onChange={event => setNewStudent({ ...newStudent, [field]: event.target.value })} />
              </div>
            ))}
            {createProfileError ? <Alert variant="destructive"><AlertDescription>{createProfileError}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={documentTransitioning} onClick={() => setCreateProfileOpen(false)}>取消</Button>
              <Button type="submit" disabled={documentTransitioning}>新建</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={profileToDelete !== null} onOpenChange={open => {
        if (!open && !documentTransitioningRef.current) setProfileToDelete(null)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除当前档案？</DialogTitle>
            <DialogDescription>
              {profileToDelete?.full_name} · {profileToDelete?.student_number}
              的档案和文档将从工作台移除，可在「已删除档案」中恢复。已导出的文件仍保存在原位置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={documentTransitioning} onClick={() => setProfileToDelete(null)}>取消</Button>
            <Button variant="destructive" disabled={documentTransitioning} onClick={() => {
              if (profileToDelete) void changeDeletedProfile("delete", profileToDelete.id)
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deletedProfilesOpen} onOpenChange={open => {
        if (!documentTransitioningRef.current) setDeletedProfilesOpen(open)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>已删除档案</DialogTitle>
            <DialogDescription>恢复后会打开档案并显示原有文档。</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <ul className="grid gap-2">
              {deletedProfiles.map(item => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-words">{item.full_name} · {item.student_number}</span>
                  <Button variant="outline" disabled={documentTransitioning} aria-label={`恢复 ${item.full_name} · ${item.student_number}`}
                    onClick={() => void changeDeletedProfile("restore", item.id)}>恢复</Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <AppSidebar
        studentName={draft.studentName}
        variant="inset"
        profileActive={activePane === "profile"}
        profiles={profiles}
        activeProfileId={selectedProfileId}
        toolsActive={activePane === "tools"}
        appearanceActive={activePane === "appearance"}
        inspectionActive={activePane === "inspection"}
        generatedDocumentCount={generatedDocumentCount}
        updateLabel={releaseHasNewVersion ? updateStatus.state === "downloaded" ? "更新已就绪" : updateStatus.state === "downloading" ? "正在下载更新" : "新版本可用" : undefined}
        onOpenUpdate={() => setDismissedUpdateVersion(null)}
        thesisToolsActive={activePane === "thesis_tools"}
        activeThesisTool={activeThesisTool}
        activeDocumentId={activePane === "document" ? activeDocumentId ?? null : null}
        documents={documents}
        deletedDocuments={deletedDocuments}
        documentsHasMore={documentPages.active?.has_more}
        deletedDocumentsHasMore={documentPages.deleted?.has_more}
        documentsLoading={documentListsLoading.active}
        deletedDocumentsLoading={documentListsLoading.deleted}
        onLoadMoreDocuments={loadMoreDocuments}
        onSelectProfile={() => setActivePane("profile")}
        onSelectTools={() => setActivePane("tools")}
        onSelectAppearance={() => setActivePane("appearance")}
        onSelectInspection={() => setActivePane("inspection")}
        onSelectDocument={selectDocumentFile}
        onSelectThesisTool={(toolId) => {
          setActiveThesisTool(toolId)
          setActivePane("thesis_tools")
        }}
        onCreateDocument={createDocumentFile}
        onRenameDocument={(documentId, title) =>
          runDocumentMutation((api) => api.renameDocument({ documentId, title }))
        }
        onDeleteDocument={(documentId) =>
          runDocumentMutation((api) => api.deleteDocument(documentId))
        }
        onRestoreDocument={(documentId) =>
          runDocumentMutation((api) => api.restoreDocument(documentId))
        }
        onPurgeDocument={(documentId) =>
          runDocumentMutation((api) => api.purgeDocument(documentId))
        }
        disabled={workspaceDisabled || exportState.status === "exporting"}
        inspectionDisabled={workspaceDisabled}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        {activePane !== "document" ? <SiteHeader
          title={
            activePane === "profile"
              ? "基本信息"
              : activePane === "tools"
                ? "效率工具"
              : activePane === "appearance"
                ? "主题外观"
              : activePane === "inspection"
                ? "导出记录"
              : activePane === "thesis_tools"
                ? "排版工具"
                : ""
          }
          status={activePane === "profile" ? <SaveStatusBadge state={saveState} /> : undefined}
          showSidebarTrigger={activePane !== "thesis_tools"}
        /> : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
            {activePane === "profile" ||
            activePane === "tools" ||
            activePane === "appearance" ? (
              <div className="min-h-0 flex-1">{mainPanel}</div>
            ) : activePane === "inspection" ? (
              <div className="min-h-0 flex-1">{mainPanel}</div>
            ) : (
              <div className="flex min-h-0 flex-1">
                {activePane === "thesis_tools" ? thesisSectionNavigation : sectionNavigation}
                <div className="min-w-0 flex-1">{mainPanel}</div>
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
      <Sheet
        open={previewOpen && activePane === "document" && activeDocumentType !== "thesis"}
        onOpenChange={setPreviewOpen}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          finalFocus={() => {
            const target = previewCheckTarget.current
            if (!target) return true
            const root = window.document.querySelector<HTMLElement>(target.selector)
            return root?.matches('button, input, textarea, select, [contenteditable="true"], [tabindex]')
              ? root
              : root?.querySelector<HTMLElement>('button, input, textarea, select, [contenteditable="true"], [tabindex]') ?? false
          }}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
          style={
            isMobile
              ? undefined
              : {
                  width: previewDrawerWidth,
                  maxWidth: previewDrawerMaxWidth,
                }
          }
        >
          {/* A transparent spacer lets the standard PanelGroup resize the Sheet's outer edge.
              Only the preview and handle receive pointer events; backdrop dismissal stays native. */}
          <ResizablePanelGroup
            key={isMobile ? "mobile-preview" : "desktop-preview"}
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{ width: isMobile ? "100%" : previewDrawerMaxWidth + 1 }}
          >
            {!isMobile ? <>
              <ResizablePanel id="preview-spacer" aria-hidden minSize={0} defaultSize={previewDrawerMaxWidth - clampPreviewDrawerWidth(previewPanelInitialWidth, previewDrawerMaxWidth)} />
              <ResizableHandle withHandle className="pointer-events-auto" aria-label="调整预览抽屉宽度" aria-valuetext={`${previewDrawerWidth} 像素`} />
            </> : null}
            <ResizablePanel
              id="preview-content"
              defaultSize={isMobile ? "100%" : clampPreviewDrawerWidth(previewPanelInitialWidth, previewDrawerMaxWidth)}
              minSize={isMobile ? 0 : PREVIEW_DRAWER_MIN_WIDTH}
              maxSize={isMobile ? "100%" : previewDrawerMaxWidth}
              groupResizeBehavior={isMobile ? "preserve-relative-size" : "preserve-pixel-size"}
              onResize={handlePreviewPanelResize}
              className="pointer-events-auto flex min-h-0 flex-col"
            >
          <SheetHeader className="flex-row items-center justify-between gap-3 border-b">
            <SheetTitle>预览&导出</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="导出"
                    disabled={exportDisabled}
                    title={exportDisabledReason}
                  />
                }
              >
                {exportState.status === "exporting" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <ActionFeedbackIcon token={exportFeedback.completed.export}><AnimatedActionIcon icon={DownloadIcon} /></ActionFeedbackIcon>
                )}
                <span>
                  {exportState.status === "exporting"
                    ? "正在导出"
                    : previewReady
                      ? "导出"
                      : "生成预览后可导出"}
                </span>
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {activeDocumentType !== "thesis" ? <DropdownMenuItem onClick={() => void startExport(["docx"])}>
                  导出 Word
                </DropdownMenuItem> : null}
                <DropdownMenuItem onClick={() => void startExport(["pdf"])}>
                  导出 PDF
                </DropdownMenuItem>
                {activeDocumentType !== "thesis" ? <DropdownMenuItem onClick={() => void startExport(["tex"])}>
                  导出 LaTeX 源码包
                </DropdownMenuItem> : null}
                {activeDocumentType !== "thesis" ? <DropdownMenuItem
                  onClick={() => void startExport(["docx", "pdf"])}
                >
                  同时导出 Word 和 PDF
                </DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SheetHeader>
          <div className="min-h-0 flex-1">{previewPanel}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SheetContent>
      </Sheet>
      <EnvironmentOnboardingDialog
        open={environmentGuideOpen}
        revisiting
        environment={environment}
        onRefresh={() => void refreshEnvironment()}
        onComplete={() => setEnvironmentGuideOpen(false)}
        onQuit={() => void getDesktopApi()?.quitApp()}
        onOpenGuide={(toolId) => void openToolLink(toolId)}
      />
      <Dialog
        open={releaseBlocking}
        onOpenChange={() => undefined}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {releaseIsRetired
                ? "当前版本已停止服务"
                : releaseRequiresUpdate
                  ? "需要更新后继续使用"
                  : releaseAnnouncement?.title ?? "重要通知"}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {releaseIsRetired
                ? "请安装最新版本，或查看使用说明了解后续安排。"
                : releaseRequiresUpdate
                  ? updateStatus.state === "downloaded"
                    ? `版本 ${updateStatus.version} 已下载，可以安装。`
                    : updateStatus.state === "available"
                      ? updateStatus.downloadFailed
                        ? "下载失败，请重试。下载完成后需手动安装。"
                        : `版本 ${updateStatus.version} 可用，请下载并手动安装。`
                      : updateStatus.state === "downloading" ? `正在下载版本 ${updateStatus.version}。` : "正在检查更新…"
                  : releaseAnnouncement?.body}
            </DialogDescription>
          </DialogHeader>
          {updateDownloadProgress}
          <DialogFooter>
            <Button variant="outline" onClick={() => void getDesktopApi()?.quitApp()}>
              退出应用
            </Button>
            {releaseControl?.helpUrl ? (
              <Button variant="outline" onClick={() => void openReleaseHelp()}>
                <AnimatedActionIcon icon={LinkIcon} />
                查看说明
              </Button>
            ) : null}
            {updateStatus.state === "available" ? (
              <Button onClick={() => void downloadUpdate()}>
                <AnimatedActionIcon icon={DownloadIcon} />
                {updateStatus.downloadFailed ? "重试下载" : "下载更新"}
              </Button>
            ) : updateStatus.state === "downloaded" ? (
              <Button onClick={() => void revealDownloadedUpdate()}>
                <AnimatedActionIcon icon={FolderOpenIconAnimated} />
                显示更新文件
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={releaseNoticeOpen}
        onOpenChange={(open) => {
          if (open) return
          if (releaseControl?.serviceStatus === "maintenance") {
            setMaintenanceDismissed(true)
          }
          if (releaseAnnouncement?.dismissible) {
            setDismissedAnnouncementId(releaseAnnouncement.id)
          }
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {releaseControl?.serviceStatus === "maintenance"
                ? "服务维护通知"
                : releaseAnnouncement?.title ?? "软件公告"}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {releaseAnnouncement?.body ??
                "服务维护中，本地编辑仍可使用。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {releaseControl?.helpUrl ? (
              <Button variant="outline" onClick={() => void openReleaseHelp()}>
                <AnimatedActionIcon icon={LinkIcon} />
                查看说明
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (releaseControl?.serviceStatus === "maintenance") {
                  setMaintenanceDismissed(true)
                }
                if (releaseAnnouncement) {
                  setDismissedAnnouncementId(releaseAnnouncement.id)
                }
              }}
            >
              <AnimatedActionIcon icon={CircleCheckIcon} />
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={
          !releaseBlocking &&
          !releaseNoticeOpen &&
          (updateStatus.state === "available" || updateStatus.state === "downloading" || updateStatus.state === "downloaded") &&
          dismissedUpdateVersion !== updateStatus.version
        }
        onOpenChange={(open) => {
          if (!open && (updateStatus.state === "available" || updateStatus.state === "downloading" || updateStatus.state === "downloaded")) {
            setDismissedUpdateVersion(updateStatus.version)
          }
        }}
      >
        <DialogContent showCloseButton={updateStatus.state === "downloading"}>
          <DialogHeader>
            <DialogTitle>{updateStatus.state === "downloaded" ? "更新已就绪" : updateStatus.state === "downloading" ? updateStatus.phase === "verifying" ? "正在检查安装包" : "下载更新" : "发现新版本"}</DialogTitle>
            <DialogDescription>
              {updateStatus.state === "downloaded"
                ? `版本 ${updateStatus.version} 已下载并通过校验，可打开安装包进行安装。`
                : updateStatus.state === "available"
                  ? updateStatus.downloadFailed
                    ? "下载失败，请检查网络后重试。"
                    : `版本 ${updateStatus.version} 可用，安装包约 ${Math.ceil(updateStatus.sizeBytes / 1_000_000)} MB。`
                  : updateStatus.state === "downloading" ? `版本 ${updateStatus.version}` : null}
            </DialogDescription>
          </DialogHeader>
          {updateDownloadProgress}
          {updateStatus.state !== "downloading" ? <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (updateStatus.state === "available" || updateStatus.state === "downloaded") {
                  setDismissedUpdateVersion(updateStatus.version)
                }
              }}
            >
              稍后处理
            </Button>
            {updateStatus.state === "downloaded" ? (
              <Button onClick={() => void revealDownloadedUpdate()}>
                <AnimatedActionIcon icon={FolderOpenIconAnimated} />
                显示更新文件
              </Button>
            ) : (
              <Button disabled={updateStatus.state !== "available"} onClick={() => void downloadUpdate()}>
                <AnimatedActionIcon icon={DownloadIcon} />
                {updateStatus.state === "available" && updateStatus.downloadFailed ? "重试下载" : "下载更新"}
              </Button>
            )}
          </DialogFooter> : null}
        </DialogContent>
      </Dialog>
      <Toaster />
    </SidebarProvider>
  )
}
