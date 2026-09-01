import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  ChevronDownIcon,
  FileCheck2Icon,
  FileClockIcon,
  FileTextIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PackageCheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react"
import { format, isValid, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"

import { AppSidebar } from "@/components/workbench/app-sidebar"
import type { CreateDocumentRequest } from "@/components/workbench/nav-documents"
import { DiagnosticSupport } from "@/components/workbench/diagnostic-support"
import { ExportHistoryStatusBadge } from "@/components/workbench/export-history-status-badge"
import {
  DocumentSectionNav,
  type DocumentSectionOption,
} from "@/components/workbench/document-section-nav"
import {
  createOutlineEditorItem,
  OutlineEditor,
  type OutlineEditorItem,
  type OutlineLevel,
  validateOutlineItems,
} from "@/components/workbench/outline-editor"
import {
  StructuredContentEditor,
  type EditorSelectionSnapshot,
} from "@/components/workbench/structured-content-editor"
import { ReferenceImporter } from "@/components/workbench/reference-importer"
import {
  SaveStatusBadge,
  type SaveState,
} from "@/components/workbench/save-status-badge"
import { TaskScheduleEditor } from "@/components/workbench/task-schedule-editor"
import { SiteHeader } from "@/components/workbench/site-header"
import { ToolDirectory } from "@/components/workbench/tool-directory"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
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
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  isParagraphInput,
  isStructuredBodyValue,
  type StructuredEditorMode,
} from "@/lib/structured-content-editor"
import {
  createTaskScheduleEditorItem,
  type TaskScheduleEditorItem,
  validateTaskScheduleItems,
} from "@/lib/task-schedule"
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
  PrivacyNoticeStatus,
  PreviewResult,
  StudentProfile,
  StudentProfileDraft,
  StudentProfileInput,
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
  title: StructuredBodyValue
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
  directory: OutlineEditorItem[]
  mainResearchContent: StructuredBodyValue
  progress: StructuredBodyValue
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

type TextDraftField = Exclude<
  keyof Draft,
  | StructuredDraftField
  | "directory"
  | "taskSchedule"
  | "references"
  | "taskReferences"
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
  | { status: "error"; message: string }

type PreviewState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "generating" }
  | { status: "ready"; result: PreviewResult; stale: boolean }
  | { status: "error"; message: string }

type ExportHistoryState =
  | { status: "loading"; jobs: ExportJobSummary[] }
  | { status: "ready"; jobs: ExportJobSummary[] }
  | { status: "error"; jobs: ExportJobSummary[]; message: string }

type PendingExport = {
  requestId: string
  documentId: string
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

type ActivePane = "profile" | "document" | "inspection" | "tools"

type DocumentViewState = {
  scrollTop: number
  selections: Partial<Record<StructuredDraftField, EditorSelectionSnapshot>>
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

type PrivacyNoticeState =
  | { status: "loading" }
  | { status: "required"; result: PrivacyNoticeStatus }
  | { status: "accepted"; result: PrivacyNoticeStatus }
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
  title: [],
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
  directory: [createOutlineEditorItem()],
  mainResearchContent: [],
  progress: [],
  taskBasicContent: [],
  taskSchedule: [createTaskScheduleEditorItem()],
  taskRequiredMaterials: [],
  taskReferences: [],
  taskReferencesBibtex: "",
  taskNature: "",
  taskSourceType: "",
  taskResearchLevel: "",
  taskOtherResearchLevel: "",
  taskProjectNumber: "",
  taskSelfProposedBy: "",
}

const PROFILE_FIELDS = new Set<TextDraftField>([
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
const PREVIEW_DRAWER_KEYBOARD_STEP = 32
const PREVIEW_ACCEPTANCE_BOUNDARY_TOAST_ID = "preview-acceptance-boundary"

function showPreviewAcceptanceBoundary(): void {
  toast.info("验收边界", {
    id: PREVIEW_ACCEPTANCE_BOUNDARY_TOAST_ID,
    description:
      "这里显示正式模板生成的 PDF 页面，但与 Word/WPS 中的最终效果可能存在差异，仍需在目标编辑器中人工验收。",
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

function paragraphInputPlainText(value: unknown): string {
  if (typeof value === "string") return value
  const paragraph = recordValue(value)
  if (!Array.isArray(paragraph.runs)) return ""
  return paragraph.runs
    .map((run) => textValue(recordValue(run).text))
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
      record.runs.some((run) => textValue(recordValue(run).text).trim().length > 0)
    )
  }
  const blockHasText = (block: unknown): boolean => {
    if (paragraphHasText(block)) return true
    const record = recordValue(block)
    if (record.type === "image") return textValue(record.path).trim().length > 0
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
    const items = value.map((rawItem, index) => {
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
  if (value === "task_book" || value === "midterm") return value
  return "proposal"
}

const documentTypeLabels: Record<DocumentType, string> = {
  proposal: "开题报告",
  task_book: "任务书",
  midterm: "中期检查表",
}

const defaultDocumentSections: Record<DocumentType, string> = {
  proposal: "proposal_significance",
  task_book: "task_basic",
  midterm: "document_info",
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
): DocumentSectionOption[] {
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
        state: "complete",
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
          isValidDraftDate(draft.checkDate),
          draft.checkDate.trim().length > 0,
        ),
      },
      {
        id: "midterm_directory",
        label: "论文目录",
        description: "一至四级结构化目录",
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
          structuredBodyHasText(draft.mainResearchContent),
          structuredBodyHasText(draft.mainResearchContent),
        ),
      },
      {
        id: "midterm_progress",
        label: "进展情况",
        description: "已完成工作和当前进度",
        state: completionState(
          structuredBodyHasText(draft.progress),
          structuredBodyHasText(draft.progress),
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
        structuredBodyHasText(draft.researchContent),
        structuredBodyHasText(draft.researchContent),
      ),
    },
    {
      id: "proposal_methods",
      label: "研究方法",
      description: "研究方法与技术手段",
      state: completionState(
        structuredBodyHasText(draft.methods),
        structuredBodyHasText(draft.methods),
      ),
    },
    {
      id: "proposal_steps",
      label: "研究步骤",
      description: "实际推进顺序和阶段安排",
      state: completionState(
        structuredBodyHasText(draft.steps),
        structuredBodyHasText(draft.steps),
      ),
    },
    {
      id: "proposal_references",
      label: "参考文献",
      description: "独立保存的参考文献条目",
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

function draftIsExportReady(draft: Draft, documentType: DocumentType): boolean {
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
    const directoryErrors = validateOutlineItems(draft.directory)
    return (
      draft.checkDate.trim().length > 0 &&
      isValidDraftDate(draft.checkDate) &&
      directoryErrors.length === 0 &&
      structuredBodyHasText(draft.mainResearchContent) &&
      structuredBodyHasText(draft.progress)
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
        directory: directoryItems(draft.directory),
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
  document: DocumentRecord,
  fallback?: Draft,
): Draft {
  const content = recordValue(document.content)
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
  const legacyContent = isDraft(document.content) ? document.content : {}
  return {
    ...emptyDraft,
    ...fallback,
    ...legacyContent,
    title: sharedThesisTitleValue(
      profileDraft,
      profile,
      metadata.title,
      legacyContent.title,
      fallback?.title,
    ),
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
    researchContent: structuredBodyValue(
      sections.research_content,
      legacyContent.researchContent,
      fallback?.researchContent,
    ),
    methods: structuredBodyValue(
      sections.methods_and_means,
      legacyContent.methods,
      fallback?.methods,
    ),
    steps: structuredBodyValue(
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
      document.document_type === "proposal"
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
    directory: Array.isArray(sections.directory)
      ? legacyDirectoryItems(sections.directory)
      : legacyDirectoryItems(legacyContent.directory ?? fallback?.directory),
    mainResearchContent: structuredBodyValue(
      sections.main_research_content,
      legacyContent.mainResearchContent,
      fallback?.mainResearchContent,
    ),
    progress: structuredBodyValue(
      sections.progress,
      legacyContent.progress,
      fallback?.progress,
    ),
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
      document.document_type === "task_book"
        ? textValue(bibliography.source_text) ||
          legacyContent.taskReferencesBibtex ||
          fallback?.taskReferencesBibtex ||
          ""
        : "",
    taskNature:
      textValue(topicInformation.nature) ||
      legacyContent.taskNature ||
      fallback?.taskNature ||
      "",
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
    class_name:
      normalizeAcademicClassLabel(draft.className) ||
      normalizeAcademicClassLabel(current?.class_name ?? ""),
    advisor_name: advisorEntriesFromDraft(draft)
      .map((entry) => entry.name.trim())
      .join(ADVISOR_SEPARATOR),
    advisor_title: advisorEntriesFromDraft(draft)
      .map((entry) => entry.title.trim())
      .join(ADVISOR_SEPARATOR),
    graduation_cohort: normalizeGraduationCohort(draft.graduationCohort),
    thesis_title: structuredClone(draft.title),
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

function parseDraftDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = parseISO(value)
  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== value) return undefined
  return parsed
}

function isValidDraftDate(value: string): boolean {
  return parseDraftDate(value) !== undefined
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
  disabled,
  suggestions,
}: {
  id: TextDraftField
  label: string
  value: string
  onChange: (field: TextDraftField, value: string) => void
  placeholder?: string
  maxLength?: number
  error?: string
  disabled?: boolean
  suggestions?: readonly string[]
}) {
  const uniqueSuggestions = suggestions
    ? Array.from(new Set(suggestions))
    : []
  const emitValue = (nextValue: string) => {
    const boundedValue =
      typeof maxLength === "number" ? nextValue.slice(0, maxLength) : nextValue
    if (value === boundedValue) return
    onChange(id, boundedValue)
  }
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {uniqueSuggestions.length > 0 ? (
        <Combobox
          items={uniqueSuggestions}
          filter={null}
          inputValue={value}
          value={uniqueSuggestions.includes(value) ? value : null}
          onInputValueChange={(nextValue, eventDetails) => {
            if (eventDetails.reason === "input-change") {
              emitValue(nextValue)
            }
          }}
          onValueChange={(nextValue) => {
            if (nextValue !== null) emitValue(nextValue)
          }}
        >
          <ComboboxInput
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              无匹配项，可直接输入自定义内容
            </ComboboxEmpty>
            <ComboboxList>
              {(suggestion: string) => (
                <ComboboxItem key={suggestion} value={suggestion}>
                  {suggestion}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <Input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(event) => emitValue(event.target.value)}
        />
      )}
      {error ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function DateField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: TextDraftField
  label: string
  value: string
  onChange: (field: TextDraftField, value: string) => void
  error?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedDate = parseDraftDate(value)

  return (
    <div className="grid gap-2">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              data-empty={!selectedDate}
              disabled={disabled}
              className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
            />
          }
        >
          <CalendarIcon />
          {selectedDate ? (
            format(selectedDate, "yyyy年M月d日", { locale: zhCN })
          ) : (
            <span>选择检查日期</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            locale={zhCN}
            onSelect={(date) => {
              if (!date) return
              onChange(id, format(date, "yyyy-MM-dd"))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {error ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function StructuredBodyField({
  id,
  label,
  value,
  onChange,
  description,
  error,
  disabled,
  mode = "body",
  selectionSnapshot,
  onSelectionChange,
  fillHeight = false,
}: {
  id: StructuredDraftField
  label: string
  value: StructuredBodyValue
  onChange: (field: StructuredDraftField, value: StructuredBodyValue) => void
  description: string
  error?: string
  disabled?: boolean
  mode?: StructuredEditorMode
  selectionSnapshot?: EditorSelectionSnapshot
  onSelectionChange?: (selection: EditorSelectionSnapshot) => void
  fillHeight?: boolean
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
          onChange={(nextValue) => onChange(id, nextValue)}
          disabled={disabled}
          ariaLabel={label}
          ariaDescribedBy={describedBy}
          ariaInvalid={Boolean(error)}
          placeholder={`输入${label}`}
          mode={mode}
          selectionSnapshot={selectionSnapshot}
          onSelectionChange={onSelectionChange}
          fillHeight={fillHeight}
          className={fillHeight ? "min-h-0 flex-1" : undefined}
        />
      ) : (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>本栏包含暂不支持编辑的内容块</AlertTitle>
          <AlertDescription>
            检测到图片或其他非文本结构。为避免覆盖原内容，本栏已暂停编辑；原始结构仍会原样保存并可继续检查、预览和导出。
          </AlertDescription>
        </Alert>
      )}
      {error ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SelectField({
  id,
  label,
  value,
  options,
  placeholder,
  error,
  disabled,
  onChange,
}: {
  id: TextDraftField
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  placeholder: string
  error?: string
  disabled?: boolean
  onChange: (field: TextDraftField, value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Select
        value={value || null}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onChange(id, nextValue)
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={placeholder}>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="text-xs text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

const ADVISOR_TITLE_OPTIONS = [
  "教授",
  "副教授",
  "助理教授",
  "特聘教授",
  "讲师",
  "高级工程师",
  "副研究员",
  "专职副研究员",
  "实验师",
] as const
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
  { value: "graduation_design", label: "毕业设计" },
  { value: "graduation_thesis", label: "毕业论文" },
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
  draft,
  onChange,
  onStructuredBodyChange,
  disabled,
  workspace,
}: {
  draft: Draft
  onChange: (field: TextDraftField, value: string) => void
  onStructuredBodyChange: (
    field: StructuredDraftField,
    value: StructuredBodyValue,
  ) => void
  disabled: boolean
  workspace: WorkspaceLoadState
}) {
  const complete = profileIsComplete(draft)
  const selectedCollege = findCollegeOption(draft.college)
  const selectedMajor = selectedCollege?.majors.find(
    (option) => option.major === draft.major.trim(),
  )
  const collegeSuggestions = ACADEMIC_OPTIONS.map((option) => option.college)
  const majorSuggestions = selectedCollege?.majors.map((option) => option.major) ?? []
  const classSuggestions = selectedMajor?.classes ?? []
  const advisorEntries = advisorEntriesFromDraft(draft)
  const titleError = !structuredBodyPlainText(draft.title).trim()
    ? "请输入论文题目。"
    : structuredBodyPlainText(draft.title).length > THESIS_TITLE_MAX_LENGTH
      ? `论文题目最多 ${THESIS_TITLE_MAX_LENGTH} 个字符。`
      : undefined

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

  const removeAdvisorEntry = (index: number) => {
    if (advisorEntries.length === 1) return
    commitAdvisorEntries(
      advisorEntries.filter((_, entryIndex) => entryIndex !== index),
    )
  }

  const moveAdvisorEntry = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= advisorEntries.length) return
    const nextEntries = [...advisorEntries]
    ;[nextEntries[index], nextEntries[targetIndex]] = [
      nextEntries[targetIndex],
      nextEntries[index],
    ]
    commitAdvisorEntries(nextEntries)
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

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-4xl gap-6 p-6">
        <p className="text-sm text-muted-foreground">
          基础信息和论文题目只在这里维护一次，开题报告、任务书、中期检查和后续过程文档统一读取。
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
              姓名、学号、毕业届别、学院、专业、班级、指导教师和职称完整后，过程文档才能检查和导出。
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>论文题目</CardTitle>
          </CardHeader>
          <CardContent>
            <StructuredContentEditor
              value={draft.title}
              onChange={(value) => onStructuredBodyChange("title", value)}
              disabled={disabled}
              ariaLabel="论文题目"
              ariaDescribedBy={titleError ? "title-error" : undefined}
              ariaInvalid={Boolean(titleError)}
              placeholder="输入论文题目"
              mode="inline"
            />
            {titleError ? (
              <p className="mt-2 text-xs text-destructive" id="title-error">
                {titleError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>共用基础信息</CardTitle>
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
              id="graduationCohort"
              label="毕业届别"
              value={draft.graduationCohort}
              placeholder="例如：2026届"
              suggestions={GRADUATION_COHORT_OPTIONS}
              maxLength={GRADUATION_COHORT_MAX_LENGTH}
              error={
                !draft.graduationCohort.trim()
                  ? "请输入毕业届别。"
                  : draft.graduationCohort.length >
                      GRADUATION_COHORT_MAX_LENGTH
                    ? "毕业届别最多 20 个字符。"
                    : undefined
              }
              onChange={onChange}
              disabled={disabled}
            />
            <Field
              id="college"
              label="学院"
              value={draft.college}
              suggestions={collegeSuggestions}
              error={!draft.college.trim() ? "请输入学院。" : undefined}
              onChange={changeCollege}
              disabled={disabled}
            />
            <Field
              id="major"
              label="专业"
              value={draft.major}
              suggestions={majorSuggestions}
              error={!draft.major.trim() ? "请输入专业。" : undefined}
              onChange={changeMajor}
              disabled={disabled}
            />
            <Field
              id="className"
              label="班级"
              value={draft.className}
              suggestions={classSuggestions}
              error={!draft.className.trim() ? "请输入班级。" : undefined}
              onChange={onChange}
              disabled={disabled}
            />
            <div className="grid gap-3 md:col-span-2">
              <p className="text-sm font-medium">指导教师</p>
              {advisorEntries.map((entry, index) => {
                const nameLabel = index === 0 ? "指导教师" : `第${index + 1}指导教师`
                const titleLabel =
                  index === 0 ? "指导教师职称" : `第${index + 1}指导教师职称`
                const titleId = `advisor-title-${index}`
                return (
                  <div
                    className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
                    key={index}
                  >
                    <div className="grid gap-2">
                      <label className="text-sm font-medium" htmlFor={`advisor-${index}`}>
                        {nameLabel}
                      </label>
                      <Input
                        id={`advisor-${index}`}
                        value={entry.name}
                        placeholder="只填写姓名，不填写职称"
                        disabled={disabled}
                        maxLength={30}
                        aria-invalid={!entry.name.trim()}
                        onChange={(event) =>
                          updateAdvisorEntry(index, "name", event.target.value)
                        }
                      />
                      {!entry.name.trim() ? (
                        <p className="text-xs text-destructive">请输入指导教师姓名。</p>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium" htmlFor={titleId}>
                        {titleLabel}
                      </label>
                      <Combobox
                        items={[...ADVISOR_TITLE_OPTIONS]}
                        filter={null}
                        inputValue={entry.title}
                        value={
                          ADVISOR_TITLE_OPTIONS.includes(
                            entry.title as (typeof ADVISOR_TITLE_OPTIONS)[number],
                          )
                            ? entry.title
                            : null
                        }
                        onInputValueChange={(nextValue, eventDetails) => {
                          if (eventDetails.reason === "input-change") {
                            updateAdvisorEntry(index, "title", nextValue)
                          }
                        }}
                        onValueChange={(nextValue) => {
                          if (nextValue !== null) {
                            updateAdvisorEntry(index, "title", nextValue)
                          }
                        }}
                      >
                        <ComboboxInput
                          id={titleId}
                          placeholder="选择或输入职称"
                          disabled={disabled}
                          maxLength={30}
                          aria-invalid={!entry.title.trim()}
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            无匹配项，可直接输入自定义内容
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(suggestion: string) => (
                              <ComboboxItem key={suggestion} value={suggestion}>
                                {suggestion}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {!entry.title.trim() ? (
                        <p className="text-xs text-destructive">请输入指导教师职称。</p>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`上移${nameLabel}`}
                        disabled={disabled || index === 0}
                        onClick={() => moveAdvisorEntry(index, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`下移${nameLabel}`}
                        disabled={disabled || index === advisorEntries.length - 1}
                        onClick={() => moveAdvisorEntry(index, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`删除${nameLabel}`}
                        disabled={disabled || advisorEntries.length === 1}
                        onClick={() => removeAdvisorEntry(index)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={disabled}
                onClick={addAdvisorEntry}
              >
                <PlusIcon />
                添加指导教师
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}

function DocumentEditor({
  documentId,
  documentType,
  activeSection,
  viewState,
  onViewStateChange,
  draft,
  onChange,
  onStructuredBodyChange,
  onDirectoryChange,
  onTaskScheduleChange,
  disabled,
  workspace,
  saveState,
  onRetryLoad,
  onRetrySave,
}: {
  documentId: string
  documentType: DocumentType
  activeSection: string
  viewState: DocumentViewState
  onViewStateChange: (
    update: (current: DocumentViewState) => DocumentViewState,
  ) => void
  draft: Draft
  onChange: (field: TextDraftField, value: string) => void
  onStructuredBodyChange: (
    field: StructuredDraftField,
    value: StructuredBodyValue,
  ) => void
  onDirectoryChange: (value: OutlineEditorItem[]) => void
  onTaskScheduleChange: (value: TaskScheduleEditorItem[]) => void
  disabled: boolean
  workspace: WorkspaceLoadState
  saveState: SaveState
  onRetryLoad: () => void
  onRetrySave: () => void
}) {
  const isMidterm = documentType === "midterm"
  const isTaskBook = documentType === "task_book"
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const immersiveSection = isTaskBook
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
    field: StructuredDraftField,
    selection: EditorSelectionSnapshot,
  ) => {
    onViewStateChange((current) => ({
      ...current,
      selections: { ...current.selections, [field]: selection },
    }))
  }
  const editorLocationProps = (field: StructuredDraftField) => ({
    selectionSnapshot: viewState.selections[field],
    onSelectionChange: (selection: EditorSelectionSnapshot) =>
      rememberSelection(field, selection),
  })
  const DocumentScrollContainer = immersiveSection ? "div" : ScrollArea
  const EditorSurface = immersiveSection ? "div" : Card
  const EditorSurfaceContent = immersiveSection ? "div" : CardContent

  return (
    <div className="h-full" ref={scrollRootRef}>
    <DocumentScrollContainer className="h-full">
      <div
        className={cn(
          immersiveSection
            ? "flex h-full min-h-0 w-full flex-col"
            : "mx-auto grid max-w-4xl gap-6 p-6",
        )}
      >

        {!profileIsComplete(draft) && workspace.status === "ready" ? (
          <Alert>
            <UserRoundIcon />
            <AlertTitle>学生档案尚未补全</AlertTitle>
            <AlertDescription>
              请先在左侧“学生档案”填写共用基础信息，完成后再检查或导出当前文档。
            </AlertDescription>
          </Alert>
        ) : null}

        {!structuredBodyPlainText(draft.title).trim() &&
        workspace.status === "ready" ? (
          <Alert>
            <UserRoundIcon />
            <AlertTitle>论文题目尚未填写</AlertTitle>
            <AlertDescription>
              请先在左侧“学生档案”的论文题目区域填写共用题目。
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace.status === "loading" ? (
          <Alert>
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在载入工作区</AlertTitle>
            <AlertDescription>
              正在恢复上次使用的学生档案和
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
              <Button variant="outline" size="sm" onClick={onRetryLoad}>
                <RefreshCwIcon />
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

        {activeSection === "document_info" && isMidterm ? (
        <Card className="border-0 shadow-none ring-0">
          <CardHeader>
            <CardTitle>检查日期</CardTitle>
          </CardHeader>
          <CardContent>
            <DateField
              id="checkDate"
              label="检查日期"
              value={draft.checkDate}
              error={
                isValidDraftDate(draft.checkDate)
                  ? undefined
                  : "请选择有效的检查日期。"
              }
              onChange={onChange}
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
              任务书必须从学生档案的毕业届别提取四位年份，例如“2026届”。请先修改学生档案；本页不重复填写。
            </AlertDescription>
          </Alert>
        ) : null}

        {activeSection !== "document_info" ? (
        <EditorSurface
          className={cn(
            immersiveSection ? "min-h-0 flex-1" : "border-0 shadow-none ring-0",
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
            {isTaskBook ? (
              <>
                {activeSection === "task_basic" ? (
                  <StructuredBodyField
                    id="taskBasicContent"
                    {...editorLocationProps("taskBasicContent")}
                    label="内容要求"
                    description="填写课题任务、成果要求和完成标准。"
                    value={draft.taskBasicContent}
                    error={
                      !structuredBodyHasText(draft.taskBasicContent)
                        ? "请填写至少一段内容要求。"
                        : draft.taskBasicContent.length > 80
                          ? "内容要求最多 80 个内容块。"
                          : undefined
                    }
                    onChange={onStructuredBodyChange}
                    disabled={disabled}
                    fillHeight
                  />
                ) : null}
                {activeSection === "task_schedule" ? (
                  <TaskScheduleEditor
                    value={draft.taskSchedule}
                    onChange={onTaskScheduleChange}
                    disabled={disabled}
                  />
                ) : null}
                {activeSection === "task_materials" ? (
                  <StructuredBodyField
                    id="taskRequiredMaterials"
                    {...editorLocationProps("taskRequiredMaterials")}
                    label="需收集的资料及主要参考文献资料"
                    description="填写完成任务需要收集的资料；该项可留空。"
                    value={draft.taskRequiredMaterials}
                    error={
                      draft.taskRequiredMaterials.length > 50
                        ? "需收集资料最多 50 个内容块。"
                        : undefined
                    }
                    onChange={onStructuredBodyChange}
                    disabled={disabled}
                    fillHeight
                  />
                ) : null}
                {activeSection === "task_references" ? (
                  <ReferenceImporter
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
                  <SelectField
                    id="taskNature"
                    label="选题性质"
                    value={draft.taskNature}
                    options={TASK_NATURE_OPTIONS}
                    placeholder="请选择选题性质"
                    error={draft.taskNature ? undefined : "请选择选题性质。"}
                    onChange={onChange}
                    disabled={disabled}
                  />
                  <SelectField
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
                      <SelectField
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
                    <SelectField
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
                    onChange={onDirectoryChange}
                    disabled={disabled}
                  />
                </div>
                ) : null}
                {activeSection === "midterm_research" ? (
                <StructuredBodyField
                  id="mainResearchContent"
                  {...editorLocationProps("mainResearchContent")}
                  label="研究内容"
                  description="填写当前论文的主要研究内容，可组合段落和列表。"
                  value={draft.mainResearchContent}
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                />
                ) : null}
                {activeSection === "midterm_progress" ? (
                <StructuredBodyField
                  id="progress"
                  {...editorLocationProps("progress")}
                  label="毕业论文（设计）进展情况"
                  description="按实际完成情况填写，可组合段落和列表。"
                  value={draft.progress}
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                />
                ) : null}
              </>
            ) : (
              <>
                {activeSection === "proposal_significance" ? (
                <StructuredBodyField
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
                />
                ) : null}
                {activeSection === "proposal_research" ? (
                <StructuredBodyField
                  id="researchContent"
                  {...editorLocationProps("researchContent")}
                  label="研究内容"
                  description="说明研究对象、主要问题和拟完成内容。"
                  value={draft.researchContent}
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                />
                ) : null}
                {activeSection === "proposal_methods" ? (
                <StructuredBodyField
                  id="methods"
                  {...editorLocationProps("methods")}
                  label="研究方法与手段"
                  description="与研究步骤分开填写。"
                  value={draft.methods}
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                />
                ) : null}
                {activeSection === "proposal_steps" ? (
                <StructuredBodyField
                  id="steps"
                  {...editorLocationProps("steps")}
                  label="研究步骤"
                  description="按实际推进顺序填写。"
                  value={draft.steps}
                  onChange={onStructuredBodyChange}
                  disabled={disabled}
                  fillHeight
                />
                ) : null}
                {activeSection === "proposal_references" ? (
                <ReferenceImporter
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
    </div>
  )
}

function activeTemplateCheck(
  environment: EnvironmentState,
  documentType: DocumentType,
): EnvironmentCheck | undefined {
  if (environment.status !== "ready") return undefined
  const checkId =
    documentType === "task_book"
      ? "task_book_engine"
      : documentType === "midterm"
        ? "midterm_engine"
        : "proposal_engine"
  return environment.result.checks.find((check) => check.id === checkId)
}

const checkStatusLabels: Record<CheckResult["status"], string> = {
  not_checked: "待确认",
  running: "检查中",
  pass: "通过",
  warn: "需注意",
  fail: "未通过",
  blocked: "受阻",
}

function ArtifactCheckSummary({ artifact }: { artifact: ExportArtifactRecord }) {
  const checks = artifact.checks.filter((check) =>
    ["structure", "cjk_glyph", "target_editor"].includes(check.gate),
  )
  if (checks.length === 0) return null

  const summary = checks.map((check) => {
    const label =
      check.gate === "structure"
        ? "文件结构"
        : check.gate === "cjk_glyph"
          ? "中文字形"
          : "Word/WPS"
    const status =
      check.gate === "target_editor" && check.status === "not_checked"
        ? "待验收"
        : checkStatusLabels[check.status]
    return `${label}${status}`
  })

  return (
    <span
      className="text-xs text-muted-foreground"
      title={checks.map((check) => check.message).join("\n")}
    >
      {summary.join(" · ")}
    </span>
  )
}

function PaginatedPreviewPanel({
  activePane,
  documentType,
  previewState,
  disabled,
  blockedMessage,
  onGenerate,
}: {
  activePane: ActivePane
  documentType: DocumentType
  previewState: PreviewState
  disabled: boolean
  blockedMessage?: string
  onGenerate: () => void
}) {
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-3 p-4">
        {blockedMessage && activePane !== "profile" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>暂时无法生成预览</AlertTitle>
            <AlertDescription>{blockedMessage}</AlertDescription>
          </Alert>
        ) : null}

        {previewState.status === "idle" &&
        !blockedMessage &&
        activePane !== "profile" ? (
          <Alert>
            <FileTextIcon />
            <AlertTitle>正在准备预览</AlertTitle>
            <AlertDescription>
              工作台将自动保存并检查当前内容，然后生成正式分页预览。
            </AlertDescription>
          </Alert>
        ) : null}

        {previewState.status === "checking" ? (
          <Alert aria-live="polite">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在保存并检查内容</AlertTitle>
            <AlertDescription>
              内容检查通过后，将自动生成{documentTypeLabels[documentType]}分页预览。
            </AlertDescription>
          </Alert>
        ) : null}

        {previewState.status === "generating" ? (
          <Alert aria-live="polite">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>正在生成分页预览</AlertTitle>
            <AlertDescription>
              正在调用{documentTypeLabels[documentType]}模板并检查 PDF 中文字形。
            </AlertDescription>
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
              <RefreshCwIcon />
              重新生成预览
            </Button>
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
                  <RefreshCwIcon />
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
  onRefresh,
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
  onRefresh: () => void
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
                <CardTitle>当前状态</CardTitle>
                <CardDescription>
                  {environment.status === "loading"
                    ? "正在检查运行环境。"
                    : environment.status === "error"
                      ? "文档引擎未连接，可创建故障诊断包协助排查。"
                      : !environment.result.ready
                        ? "运行环境异常，可创建故障诊断包协助排查。"
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
                  <RefreshCwIcon />
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
                    <AlertTitle>文档引擎未连接</AlertTitle>
                    <AlertDescription>{environment.message}</AlertDescription>
                  </Alert>
                ) : null}
                {environment.status === "ready" && !environment.result.ready ? (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>运行环境需要修复</AlertTitle>
                    <AlertDescription>
                      请创建故障诊断包，并将文件发送给支持人员。
                    </AlertDescription>
                  </Alert>
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
            <DiagnosticSupport />
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

        <Card>
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>导出历史</CardTitle>
                <CardDescription>查看本地产物状态并管理历史记录。</CardDescription>
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
                              <div className="grid gap-0.5">
                                {job.artifacts.map((artifact) => (
                                  <span className="grid gap-0.5" key={artifact.artifact_id}>
                                    <span>{artifact.display_name}</span>
                                    <ArtifactCheckSummary artifact={artifact} />
                                  </span>
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
                                <MoreHorizontalIcon />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  disabled={!availableArtifact}
                                  onClick={() =>
                                    availableArtifact &&
                                    onRevealArtifact(availableArtifact.artifact_id)
                                  }
                                >
                                  <FolderOpenIcon />
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
                                  <Trash2Icon />
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
                {deletingExportId ? <LoaderCircleIcon className="animate-spin" /> : null}
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
  const isMobile = useIsMobile()
  const [draft, setDraft] = useState(emptyDraft)
  const [activeSections, setActiveSections] = useState<Record<DocumentType, string>>(
    defaultDocumentSections,
  )
  const [activePane, setActivePane] = useState<ActivePane>("document")
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [deletedDocuments, setDeletedDocuments] = useState<DocumentRecord[]>([])
  const [revision, setRevision] = useState(0)
  const [workspace, setWorkspace] = useState<WorkspaceLoadState>({
    status: "loading",
  })
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
  const previewDrawerDragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" })
  const [history, setHistory] = useState<ExportHistoryState>({
    status: "loading",
    jobs: [],
  })
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null)
  const [templateInstalling, setTemplateInstalling] = useState(false)
  const [privacyNotice, setPrivacyNotice] = useState<PrivacyNoticeState>({
    status: "loading",
  })
  const [privacySubmitting, setPrivacySubmitting] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "unconfigured",
  })
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    null,
  )
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
  const startPreviewDrawerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobile) return
      previewDrawerDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: previewDrawerWidth,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    },
    [isMobile, previewDrawerWidth],
  )
  const continuePreviewDrawerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = previewDrawerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      setPreviewDrawerWidth(
        clampPreviewDrawerWidth(
          drag.startWidth + drag.startX - event.clientX,
          previewDrawerMaxWidth,
        ),
      )
    },
    [previewDrawerMaxWidth],
  )
  const stopPreviewDrawerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = previewDrawerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      previewDrawerDragRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    [],
  )
  const resizePreviewDrawerWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | undefined
      if (event.key === "ArrowLeft") {
        nextWidth = previewDrawerWidth + PREVIEW_DRAWER_KEYBOARD_STEP
      } else if (event.key === "ArrowRight") {
        nextWidth = previewDrawerWidth - PREVIEW_DRAWER_KEYBOARD_STEP
      } else if (event.key === "Home") {
        nextWidth = PREVIEW_DRAWER_MIN_WIDTH
      } else if (event.key === "End") {
        nextWidth = previewDrawerMaxWidth
      }
      if (nextWidth === undefined) return
      event.preventDefault()
      setPreviewDrawerWidth(
        clampPreviewDrawerWidth(nextWidth, previewDrawerMaxWidth),
      )
    },
    [previewDrawerMaxWidth, previewDrawerWidth],
  )
  const activeDocumentType = documentTypeFromRecord(document?.document_type)
  const sections = documentSectionOptions(draft, activeDocumentType)
  const activeSection = activeSections[activeDocumentType]
  const graduationCohort = normalizeGraduationCohort(draft.graduationCohort)
  const editVersion = useRef(0)
  const autosaveVersions = useRef(createAutosaveVersionState())
  const saving = useRef(false)
  const documentViewStates = useMemo(() => new DocumentViewStateStore(), [])
  const pendingCheckTarget = useRef<CheckNavigationTarget | null>(null)
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
      activePane !== target.pane ||
      (target.sectionId !== undefined && activeSection !== target.sectionId)
    ) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
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
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activePane, activeSection])

  const recordTelemetry = useCallback((input: TelemetryUsageEvent) => {
    const api = getDesktopApi()
    if (!api) return
    void api.recordTelemetry(input).catch(() => undefined)
  }, [])

  const loadRemoteServiceState = useCallback(async () => {
    const api = getDesktopApi()
    if (!api) return
    try {
      const [notice, update] = await Promise.all([
        api.getPrivacyNoticeStatus(),
        api.getUpdateStatus(),
      ])
      setPrivacyNotice({
        status: notice.acknowledged ? "accepted" : "required",
        result: notice,
      })
      setUpdateStatus(update)
    } catch (error) {
      setPrivacyNotice({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法读取匿名遥测与更新服务状态。",
      })
    }
  }, [])

  const isCurrentSavedRevision = (documentId: string, version: number) =>
    activeDocumentIdRef.current === documentId &&
    editVersion.current === version &&
    saveStateRef.current === "saved"

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
          title:
            structuredBodyPlainText(initial.title).trim() || "未命名开题报告",
        })
      }

      const resolvedDocument = activeDocument
      setProfile(snapshot.profile)
      setDocument(resolvedDocument)
      setDocuments(
        snapshot.documents?.some((item) => item.id === resolvedDocument.id)
          ? snapshot.documents
          : [...(snapshot.documents ?? []), resolvedDocument],
      )
      setDeletedDocuments(snapshot.deleted_documents ?? [])
      setRevision(currentRevision(resolvedDocument))
      const resolvedDraft = draftFromRecords(
        snapshot.profile,
        snapshot.profile_draft,
        resolvedDocument,
        fallback,
      )
      setDraft(resolvedDraft)
      setPreviewState({ status: "idle" })
      setExportState({ status: "idle" })
      setHistory({ status: "loading", jobs: [] })
      setPendingExport(null)
      editVersion.current = 0
      const initialFingerprints = autosaveFingerprintsForDraft(
        resolvedDraft,
        documentTypeFromRecord(resolvedDocument.document_type),
      )
      autosaveVersions.current = createAutosaveVersionState({
        profileDirty: Boolean(fallback),
        documentDirty: Boolean(fallback),
        profileFingerprint: initialFingerprints.profile,
        documentFingerprint: initialFingerprints.document,
      })
      setSaveState(fallback ? "dirty" : "saved")
      setWorkspace({ status: "ready" })
    },
    [setSaveState],
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
    const api = getDesktopApi()
    if (!api) return
    // oxlint-disable-next-line react/set-state-in-effect -- initial IPC hydration synchronizes React with the main-process remote-service state.
    void loadRemoteServiceState()
    return api.onUpdateStatus((status) => setUpdateStatus(status))
  }, [loadRemoteServiceState])

  useEffect(() => {
    if (privacyNotice.status !== "accepted") return
    if (activePane === "tools") return
    const view =
      activePane === "profile"
        ? "profile"
        : activePane === "inspection"
          ? "inspection"
          : activeDocumentType
    recordTelemetry({ name: "view_opened", view })
  }, [activeDocumentType, activePane, privacyNotice.status, recordTelemetry])

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
    async (reason: "auto" | "manual" = "auto") => {
      const api = getDesktopApi()
      if (!api || !document || workspace.status !== "ready" || saving.current) {
        return false
      }

      const versionAtStart = editVersion.current
      const draftAtStart = draft
      const documentAtStart = document
      const expectedRevision = revision
      const fingerprints = autosaveFingerprintsForDraft(
        draftAtStart,
        documentTypeFromRecord(documentAtStart.document_type),
      )
      autosaveVersions.current = reconcileAutosaveFingerprints(
        autosaveVersions.current,
        fingerprints,
      )
      const savePlan = planAutosave(autosaveVersions.current)
      saving.current = true
      setSaveState("saving")

      try {
        if (savePlan.profile !== null) {
          await api.saveProfileDraft(profileDraftFromDraft(draftAtStart))
          let savedProfile = profile
          if (profileIsComplete(draftAtStart)) {
            savedProfile = await api.saveProfile(
              profileFromDraft(draftAtStart, profile),
            )
          }
          autosaveVersions.current = acknowledgeAutosave(
            autosaveVersions.current,
            "profile",
            savePlan.profile,
            fingerprints.profile,
          )
          setProfile(savedProfile)
        }

        if (savePlan.document !== null) {
          const result = await api.saveDraft({
            documentId: documentAtStart.id,
            content: draftToContent(
              draftAtStart,
              documentTypeFromRecord(documentAtStart.document_type),
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
          setRevision(result.revision)
          setDocument((current) =>
            current
              ? {
                  ...current,
                  content: draftToContent(
                    draftAtStart,
                    documentTypeFromRecord(documentAtStart.document_type),
                  ),
                  current_revision: result.revision,
                  saved_at: result.saved_at,
                }
              : current,
          )
        }
        const savedCurrentRevision = editVersion.current === versionAtStart
        setSaveState(savedCurrentRevision ? "saved" : "dirty")
        return savedCurrentRevision
      } catch (error) {
        setSaveState(errorHasCode(error, "REVISION_CONFLICT") ? "conflict" : "error")
        return false
      } finally {
        saving.current = false
      }
    },
    [document, draft, profile, revision, setSaveState, workspace.status],
  )

  const prepareForDocumentChange = async () => {
    const api = getDesktopApi()
    if (
      !api ||
      workspace.status !== "ready" ||
      saveState === "saving" ||
      exportState.status === "exporting"
    ) {
      return false
    }
    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveNow("manual")
      if (!saved) return false
    }
    return saveState !== "conflict"
  }

  const selectDocumentFile = async (documentId: string) => {
    if (documentId === activeDocumentId) {
      setActivePane("document")
      return
    }
    const api = getDesktopApi()
    if (!api || !(await prepareForDocumentChange())) {
      throw new Error("当前内容尚未保存，暂时无法切换文档。")
    }
    const snapshot = await api.selectDocument(documentId)
    await applyWorkspace(snapshot)
    setActivePane("document")
  }

  const createDocumentFile = async (request: CreateDocumentRequest) => {
    const api = getDesktopApi()
    if (!api || !(await prepareForDocumentChange())) {
      throw new Error("当前内容尚未保存，暂时无法新建文档。")
    }
    const created = await api.createDocument({
      profile_id: profile?.id ?? null,
      document_type: request.type,
      template_version:
        request.type === "task_book"
          ? "0.1+46b6d97"
          : request.type === "midterm"
            ? "0.1+local.20260830"
            : "0.1.0-dev.1",
      schema_version: request.type === "proposal" ? "0.2" : "0.1",
      title: request.title,
      source_document_id: request.sourceDocumentId,
    })
    const snapshot = await api.selectDocument(created.id)
    await applyWorkspace(snapshot)
    setActivePane("document")
  }

  const runDocumentMutation = async (
    operation: (api: NonNullable<ReturnType<typeof getDesktopApi>>) => Promise<WorkspaceSnapshot>,
  ) => {
    const api = getDesktopApi()
    if (!api || !(await prepareForDocumentChange())) {
      throw new Error("当前内容尚未保存，暂时无法执行此操作。")
    }
    const snapshot = await operation(api)
    await applyWorkspace(snapshot)
  }

  useEffect(() => {
    if (saveState !== "dirty" || workspace.status !== "ready") return
    const timeout = window.setTimeout(() => {
      void saveNow("auto")
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [draft, revision, saveNow, saveState, workspace.status])

  const updateDraft = (field: TextDraftField, value: string) => {
    setDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === "referencesBibtex") {
        const references = cachedReferencesFromBibtex(
          value,
          PROPOSAL_REFERENCE_RULES,
        )
        return references === null ? next : { ...next, references }
      }
      if (field === "taskReferencesBibtex") {
        const taskReferences = cachedReferencesFromBibtex(
          value,
          TASK_BOOK_REFERENCE_RULES,
        )
        return taskReferences === null ? next : { ...next, taskReferences }
      }
      return next
    })
    setPreviewState((current) =>
      current.status === "ready" ? { ...current, stale: true } : current,
    )
    editVersion.current += 1
    if (PROFILE_FIELDS.has(field)) {
      autosaveVersions.current = markAutosaveEdited(
        autosaveVersions.current,
        "profile",
      )
    } else {
      autosaveVersions.current = markAutosaveEdited(
        autosaveVersions.current,
        "document",
      )
    }
    setSaveState("dirty")
  }

  const updateStructuredBody = (
    field: StructuredDraftField,
    value: StructuredBodyValue,
  ) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setPreviewState((current) =>
      current.status === "ready" ? { ...current, stale: true } : current,
    )
    editVersion.current += 1
    if (field === "title") {
      autosaveVersions.current = markAutosaveEdited(
        autosaveVersions.current,
        "profile",
      )
    } else {
      autosaveVersions.current = markAutosaveEdited(
        autosaveVersions.current,
        "document",
      )
    }
    setSaveState("dirty")
  }

  const updateDirectory = (value: OutlineEditorItem[]) => {
    setDraft((current) => ({ ...current, directory: value }))
    setPreviewState((current) =>
      current.status === "ready" ? { ...current, stale: true } : current,
    )
    editVersion.current += 1
    autosaveVersions.current = markAutosaveEdited(
      autosaveVersions.current,
      "document",
    )
    setSaveState("dirty")
  }

  const updateTaskSchedule = (value: TaskScheduleEditorItem[]) => {
    setDraft((current) => ({ ...current, taskSchedule: value }))
    setPreviewState((current) =>
      current.status === "ready" ? { ...current, stale: true } : current,
    )
    editVersion.current += 1
    autosaveVersions.current = markAutosaveEdited(
      autosaveVersions.current,
      "document",
    )
    setSaveState("dirty")
  }

  const checkContent = async (): Promise<boolean> => {
    const api = getDesktopApi()
    if (!api || !document || workspace.status !== "ready") return false
    const documentIdAtStart = document.id
    const versionAtStart = editVersion.current
    if (saveStateRef.current === "conflict") {
      recordTelemetry({
        name: "document_action",
        action: "check",
        documentType: activeDocumentType,
        outcome: "failure",
        errorCode: "REVISION_CONFLICT",
      })
      toast.error("当前草稿存在修订冲突，请重新载入后再检查或生成预览。")
      return false
    }
    if (
      saveStateRef.current === "loading" ||
      saveStateRef.current === "saving"
    ) {
      return false
    }
    if (!profileIsComplete(draft)) {
      const message =
        "请先打开左侧“学生档案”，补全姓名、学号、毕业届别、学院、专业、班级、指导教师和职称。"
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
        ? "请先打开左侧“学生档案”，填写共用论文题目。"
        : `学生档案中的论文题目最多 ${THESIS_TITLE_MAX_LENGTH} 个字符。`
      navigateToCheck({ pane: "profile", selector: '[aria-label="论文题目"]' })
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
        "任务书必须从学生档案的毕业届别提取四位年份，例如“2026届”。请先修改学生档案。"
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
        toast.error(failedCheck?.message ?? "内容检查未通过。")
      }
      return passed
    } catch (error) {
      if (!isCurrentSavedRevision(documentIdAtStart, versionAtStart)) {
        return false
      }
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
    const passed = await checkContent()
    if (
      !passed ||
      !isCurrentSavedRevision(documentIdAtStart, versionAtStart)
    ) {
      if (activeDocumentIdRef.current === documentIdAtStart) {
        setPreviewState({
          status: "error",
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
      setPreviewState({ status: "error", message })
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
          ? `本地模板工程已是最新快照 ${installed.version}。`
          : `本地模板工程已关联并同步为 ${installed.version}。`,
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
      toast.success("已在系统文件管理器中显示产物。")
    } catch (error) {
      await refreshHistory()
      toast.error(error instanceof Error ? error.message : "无法打开产物所在位置。")
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

  const executeExport = async (
    pending: PendingExport,
    overwriteConfirmed: boolean,
  ) => {
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
      setPendingExport(null)
      if (activeDocumentIdRef.current === pending.documentId) {
        setPreviewState((current) =>
          current.status === "ready" ? { ...current, stale: true } : current,
        )
        toast.error("内容或模板已经变化，请重新生成排版预览后再导出。")
      }
      return
    }
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
        previewId: pending.previewId,
        outputDirectory: pending.outputDirectory,
        formats: pending.formats,
        overwriteConfirmed,
        preflightToken: pending.preflightToken,
      })
      setExportState({ status: "succeeded", receipt })
      recordTelemetry({
        name: "document_action",
        action: "export",
        documentType: activeDocumentType,
        outcome: "success",
        formatCount: pending.formats.length,
      })
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
        previewId: previewAtStart.preview_id,
        editVersion: versionAtStart,
        previewInputSha256: previewAtStart.input_sha256,
        previewTemplateSha256: previewAtStart.template.pack_sha256,
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
      const message = error instanceof Error ? error.message : "导出预检失败。"
      setExportState({ status: "error", message })
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

  const acceptPrivacyNotice = async () => {
    const api = getDesktopApi()
    if (!api || privacySubmitting) return
    setPrivacySubmitting(true)
    try {
      const result = await api.acceptPrivacyNotice()
      setPrivacyNotice({ status: "accepted", result })
      setUpdateStatus(await api.getUpdateStatus())
    } catch (error) {
      setPrivacyNotice({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法保存匿名运行数据与更新服务确认状态。",
      })
    } finally {
      setPrivacySubmitting(false)
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

  const workspaceDisabled = workspace.status !== "ready"
  const templateCheck = activeTemplateCheck(environment, activeDocumentType)
  const templateReady = templateCheck?.status === "pass"
  const environmentFailure =
    environment.status === "ready"
      ? environment.result.checks.find(
          (check) => check.required && check.status === "fail",
        )
      : undefined
  const environmentReady =
    environment.status === "ready" && environment.result.ready
  const previewReady =
    previewState.status === "ready" &&
    !previewState.stale &&
    previewState.result.document_id === document?.id
  const previewBusy =
    previewState.status === "checking" || previewState.status === "generating"
  const previewTriggerDisabled =
    workspaceDisabled ||
    activePane !== "document" ||
    !document ||
    saveState === "loading" ||
    saveState === "saving" ||
    saveState === "conflict" ||
    exportState.status === "exporting"
  const previewGenerationDisabled =
    previewTriggerDisabled || !environmentReady || !templateReady
  const draftExportReady = draftIsExportReady(draft, activeDocumentType)
  const exportDisabled =
    workspaceDisabled ||
    activePane !== "document" ||
    !document ||
    saveState !== "saved" ||
    !environmentReady ||
    !templateReady ||
    !draftExportReady ||
    !previewReady ||
    exportState.status === "exporting"
  const exportDisabledReason = !environmentReady
    ? environmentFailure?.message ?? "请先修复本机文档环境"
    : !templateReady
      ? "请先在左侧“检查与导出”中关联可用的本地模板工程"
      : !previewReady
        ? "请先生成当前内容的排版预览"
        : draftExportReady
          ? "选择导出格式"
          : activeDocumentType === "task_book"
            ? "请补全任务书正文、进度安排、参考文献和选题信息，并确认毕业届别含四位年份"
            : activeDocumentType === "midterm"
              ? "请先填写全部必填字段、有效目录、研究内容和进展情况"
              : "请先填写全部必填字段，并确保选题意义至少有两个段落"

  const openPreviewAndExport = () => {
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
      toast.error("当前不是受支持的 Electron 桌面环境。")
      return
    }
    try {
      await api.openToolLink(toolId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开外部工具。")
    }
  }

  const editor =
    activePane === "profile" ? (
      <StudentProfileEditor
        draft={draft}
        onChange={updateDraft}
        onStructuredBodyChange={updateStructuredBody}
        disabled={workspaceDisabled}
        workspace={workspace}
      />
    ) : (
      <DocumentEditor
        documentId={document?.id ?? ""}
        documentType={activeDocumentType}
        activeSection={activeSection}
        viewState={activeDocumentViewState}
        onViewStateChange={updateActiveDocumentViewState}
        draft={draft}
        onChange={updateDraft}
        onStructuredBodyChange={updateStructuredBody}
        onDirectoryChange={updateDirectory}
        onTaskScheduleChange={updateTaskSchedule}
        disabled={workspaceDisabled}
        workspace={workspace}
        saveState={saveState}
        onRetryLoad={() => void openWorkspace("persistent")}
        onRetrySave={() => void saveNow("manual")}
      />
    )

  const inspectionPanel = (
    <InspectionPanel
      environment={environment}
      templateCheck={templateCheck}
      onRefresh={refreshEnvironment}
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
      onSectionChange={(sectionId) =>
        setActiveSections((current) => ({
          ...current,
          [activeDocumentType]: sectionId,
        }))
      }
    />
  )

  const previewPanel = (
    <PaginatedPreviewPanel
      activePane={activePane}
      documentType={activeDocumentType}
      previewState={previewState}
      blockedMessage={
        environment.status === "error"
          ? "本地文档引擎未连接，请在“检查与导出”中查看环境问题。"
          : environmentFailure
            ? environmentFailure.message
          : environment.status === "ready" && !templateReady
            ? templateCheck?.message ?? "当前文档模板工程不可用。"
            : undefined
      }
      disabled={
        previewGenerationDisabled
      }
      onGenerate={() => void generatePreview()}
    />
  )

  const mainPanel =
    activePane === "inspection" ? (
      inspectionPanel
    ) : activePane === "tools" ? (
      <ToolDirectory onOpenTool={(toolId) => void openToolLink(toolId)} />
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
      <AppSidebar
        variant="inset"
        profileActive={activePane === "profile"}
        toolsActive={activePane === "tools"}
        inspectionActive={activePane === "inspection"}
        activeDocumentId={activePane === "document" ? activeDocumentId ?? null : null}
        documents={documents}
        deletedDocuments={deletedDocuments}
        onSelectProfile={() => setActivePane("profile")}
        onSelectTools={() => setActivePane("tools")}
        onSelectInspection={() => setActivePane("inspection")}
        onSelectDocument={selectDocumentFile}
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
        <SiteHeader
          title={
            activePane === "profile"
              ? "学生档案"
              : activePane === "tools"
                ? "论文工具台"
              : activePane === "inspection"
                ? "检查与导出"
                : activeDocumentType === "task_book"
                  ? isMobile
                    ? `${graduationCohort}任务书`
                    : `${graduationCohort}任务书工作台`
                  : activeDocumentType === "midterm"
                    ? isMobile
                      ? `${graduationCohort}中期检查`
                      : `${graduationCohort}中期检查工作台`
                    : isMobile
                      ? `${graduationCohort}开题报告`
                      : `${graduationCohort}开题报告工作台`
          }
          status={activePane === "tools" ? undefined : <SaveStatusBadge state={saveState} />}
          actions={
            activePane === "document" ? (
              <>
                <Button
                  variant="outline"
                  size={isMobile ? "icon-sm" : "sm"}
                  aria-label="检查内容"
                  title="检查内容"
                  onClick={() => void checkContent()}
                  disabled={
                    workspaceDisabled ||
                    !document ||
                    saveState === "loading" ||
                    saveState === "saving" ||
                    saveState === "conflict" ||
                    exportState.status === "exporting"
                  }
                >
                  <FileCheck2Icon />
                  {isMobile ? null : <span>检查内容</span>}
                </Button>
                <Button
                  size={isMobile ? "icon-sm" : "sm"}
                  aria-label="预览&导出"
                  title="预览&导出"
                  onClick={openPreviewAndExport}
                  disabled={previewTriggerDisabled}
                >
                  {previewBusy ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <FileTextIcon />
                  )}
                  {isMobile ? null : <span>预览&导出</span>}
                </Button>
              </>
            ) : undefined
          }
        />

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
            {activePane === "profile" || activePane === "tools" ? (
              <div className="min-h-0 flex-1">{mainPanel}</div>
            ) : activePane === "inspection" ? (
              <div className="min-h-0 flex-1">{mainPanel}</div>
            ) : (
              <div className="flex min-h-0 flex-1">
                {sectionNavigation}
                <div className="min-w-0 flex-1">{mainPanel}</div>
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
      <Sheet
        open={previewOpen && activePane === "document"}
        onOpenChange={setPreviewOpen}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
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
          {!isMobile ? (
            <div
              role="separator"
              aria-label="调整预览抽屉宽度"
              aria-orientation="vertical"
              aria-valuemin={PREVIEW_DRAWER_MIN_WIDTH}
              aria-valuemax={previewDrawerMaxWidth}
              aria-valuenow={Math.round(previewDrawerWidth)}
              aria-valuetext={`${Math.round(previewDrawerWidth)} 像素`}
              tabIndex={0}
              onPointerDown={startPreviewDrawerResize}
              onPointerMove={continuePreviewDrawerResize}
              onPointerUp={stopPreviewDrawerResize}
              onPointerCancel={stopPreviewDrawerResize}
              onKeyDown={resizePreviewDrawerWithKeyboard}
              className="group absolute inset-y-0 left-0 z-10 flex w-2 -translate-x-1/2 touch-none cursor-col-resize items-center justify-center focus-visible:outline-none"
            >
              <span className="h-10 w-px bg-border group-hover:bg-foreground group-focus-visible:bg-ring" />
            </div>
          ) : null}
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
                  <FileClockIcon />
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
                <DropdownMenuItem onClick={() => void startExport(["docx"])}>
                  导出 Word
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startExport(["pdf"])}>
                  导出 PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startExport(["tex"])}>
                  导出 LaTeX 源码包
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void startExport(["docx", "pdf"])}
                >
                  同时导出 Word 和 PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SheetHeader>
          <div className="min-h-0 flex-1">{previewPanel}</div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={privacyNotice.status === "required" || privacyNotice.status === "error"}
        onOpenChange={() => undefined}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>使用说明与隐私告知</DialogTitle>
            <DialogDescription>
              继续使用前，请确认本软件的必要使用说明。
            </DialogDescription>
          </DialogHeader>
          {privacyNotice.status === "error" ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>暂时无法继续</AlertTitle>
              <AlertDescription>
                初始化未完成，请稍后重试。
              </AlertDescription>
            </Alert>
          ) : privacyNotice.status === "required" ? (
            <div className="grid gap-3 text-sm text-muted-foreground">
              <p className="text-muted-foreground">
                本软件会收集必要的匿名运行信息，用于稳定性分析、功能改进和版本服务，不会上传你填写的文档内容和个人资料。
              </p>
              <p>点击“同意并继续”即表示你已知悉并接受上述说明。</p>
              {privacyNotice.result.configurationRequired &&
              (!privacyNotice.result.telemetryConfigured ||
                !privacyNotice.result.updateConfigured) ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>当前版本暂不可用</AlertTitle>
                  <AlertDescription>
                    必要服务尚未完成配置，请退出应用并联系开发者。
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={privacySubmitting}
              onClick={() => void getDesktopApi()?.quitApp()}
            >
              退出应用
            </Button>
            {privacyNotice.status === "error" ? (
              <Button
                disabled={privacySubmitting}
                onClick={() => void loadRemoteServiceState()}
              >
                重新读取
              </Button>
            ) : privacyNotice.status === "required" ? (
              <Button
                disabled={
                  privacySubmitting ||
                  (privacyNotice.result.configurationRequired &&
                    (!privacyNotice.result.telemetryConfigured ||
                      !privacyNotice.result.updateConfigured))
                }
                onClick={() => void acceptPrivacyNotice()}
              >
                {privacySubmitting ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : null}
                同意并继续
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={
          updateStatus.state === "downloaded" &&
          dismissedUpdateVersion !== updateStatus.version
        }
        onOpenChange={(open) => {
          if (!open && updateStatus.state === "downloaded") {
            setDismissedUpdateVersion(updateStatus.version)
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>新版本已下载并校验</DialogTitle>
            <DialogDescription>
              {updateStatus.state === "downloaded"
                ? `版本 ${updateStatus.version} 已通过签名、大小和 SHA-256 校验。当前阶段不会自动覆盖正在运行的应用。`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (updateStatus.state === "downloaded") {
                  setDismissedUpdateVersion(updateStatus.version)
                }
              }}
            >
              稍后处理
            </Button>
            <Button onClick={() => void revealDownloadedUpdate()}>
              <FolderOpenIcon />
              显示更新文件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <Toaster />
    </SidebarProvider>
  )
}
