import { assessmentContent, assessmentStarterParagraphs, assessmentWritingGuidance, emptyAssessmentDraft } from "@/lib/assessment-documents"
import { emptyThesisDraft } from "@/lib/thesis-draft"
import { celebrateExportSuccess } from "@/lib/export-celebration"
vi.mock("@/lib/export-celebration", () => ({ celebrateExportSuccess: vi.fn() }))
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/react"
import { toast } from "sonner"

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div role="img" aria-label={ariaLabel} />
  ),
}))

import { TooltipProvider } from "@/components/ui/tooltip"
import { ACADEMIC_OPTIONS } from "@/data/academic-options"
import type {
  DocumentRecord,
  ExportPreflightInput,
  JsonObject,
  JsonValue,
  SaveDraftResult,
  StudentProfile,
  StudentProfileDraft,
  SztuDesktopApi,
} from "@/types/desktop-api"

import { readWorkspaceRecovery, workspaceRecoveryKey } from "@/lib/workspace-recovery"

import App from "./App"

const environmentResult = {
  ready: true,
  platform: {
    system: "Darwin",
    release: "test",
    machine: "arm64",
    python: "3.14.4",
  },
  checks: [
    {
      id: "python",
      required: true,
      status: "pass" as const,
      message: "Python 3.14.4 is supported.",
    },
    {
      id: "xelatex",
      required: true,
      status: "pass" as const,
      message: "XeLaTeX is available.",
    },
    {
      id: "template_pack",
      required: true,
      status: "pass" as const,
      message: "开发模板包可用。",
    },
    {
      id: "proposal_engine",
      required: false,
      status: "pass" as const,
      message: "开题报告模板已更新，可以导出。",
      details: { source: "development-workspace", live_workspace: true },
    },
    {
      id: "midterm_engine",
      required: false,
      status: "pass" as const,
      message: "中期检查模板已更新，可以导出。",
      details: { source: "development-workspace", live_workspace: true },
    },
    {
      id: "task_book_engine",
      required: false,
      status: "pass" as const,
      message: "任务书模板已更新，可以导出。",
      details: { source: "development-workspace", live_workspace: true },
    },
  ],
}

function environmentWithUnavailableTemplate(checkId: string) {
  return {
    ...environmentResult,
    checks: environmentResult.checks.map((check) =>
      check.id === checkId
        ? {
            ...check,
            status: "warn" as const,
            message: "当前文档模板工程不可用，请重新关联。",
          }
        : check,
    ),
  }
}

const profile: StudentProfile = {
  id: "profile-fixture",
  full_name: "合成学生甲",
  student_number: "SYN-0001",
  college: "示例学院",
  major: "示例专业",
  class_name: "示例一班",
  advisor_name: "合成教师乙",
  advisor_title: "副教授",
  graduation_cohort: "2026届",
  thesis_title: ["合成开题报告"],
  thesis_title_en: "Synthetic Thesis Title",
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
}

const completeProfileDraft: StudentProfileDraft = {
  full_name: profile.full_name,
  student_number: profile.student_number,
  college: profile.college,
  major: profile.major,
  class_name: profile.class_name ?? "",
  advisor_name: profile.advisor_name ?? "",
  advisor_title: profile.advisor_title ?? "",
  graduation_cohort: profile.graduation_cohort ?? "",
  thesis_title: structuredClone(profile.thesis_title ?? []),
  thesis_title_en: profile.thesis_title_en,
}

const emptyProfileDraft: StudentProfileDraft = {
  full_name: "",
  student_number: "",
  college: "",
  major: "",
  class_name: "",
  advisor_name: "",
  advisor_title: "",
  graduation_cohort: "",
  thesis_title: [],
  thesis_title_en: "",
}

const formDraft = {
  title: "合成开题报告",
  studentName: "合成学生甲",
  studentId: "SYN-0001",
  major: "示例专业",
  college: "示例学院",
  advisor: "合成教师乙",
  significance: "第一段\n\n第二段",
  researchContent: "合成研究内容",
  methods: "合成研究方法",
  steps: "合成研究步骤",
  references: "[1] 合成参考文献",
}

const draftContent = {
  metadata: {
    title: formDraft.title,
    student_name: formDraft.studentName,
    student_id: formDraft.studentId,
    major: formDraft.major,
    college: formDraft.college,
    advisor: formDraft.advisor,
  },
  sections: {
    significance_and_status: ["第一段", "第二段"],
    research_content: [formDraft.researchContent],
    methods_and_means: [formDraft.methods],
    research_steps: [formDraft.steps],
    references: [formDraft.references],
  },
}

const contentCheck = {
  schema_version: "1.0" as const,
  check_id: "proposal-content",
  gate: "content" as const,
  status: "pass" as const,
  blocking: true,
  message: "开题报告内容检查通过。",
  checked_at: "2026-08-30T00:00:02Z",
}

const pdfStructureCheck = {
  ...contentCheck,
  check_id: "pdf-structure",
  gate: "structure" as const,
  message: "PDF 页面尺寸与字体信息已检查。",
}

const cjkGlyphCheck = {
  ...contentCheck,
  check_id: "pdf-cjk-glyph",
  gate: "cjk_glyph" as const,
  message: "PDF 中文字形检查通过。",
}

const docxStructureCheck = {
  ...contentCheck,
  check_id: "docx-deep-structure",
  gate: "structure" as const,
  message: "Word 文件结构检查通过。",
}

const pendingTargetEditorCheck = {
  ...contentCheck,
  check_id: "target-editor",
  gate: "target_editor" as const,
  status: "not_checked" as const,
  blocking: false,
  message: "尚未记录当前导出产物的 Word/WPS 人工验收。",
}

const exportReceipt = {
  schema_version: "1.0" as const,
  export_id: "export-fixture",
  request_id: "00000000-0000-4000-8000-000000000001",
  status: "succeeded" as const,
  template: {
    template_id: "sztu.proposal.2026.local",
    version: "0.2+a0799ee",
    pack_sha256: "a".repeat(64),
  },
  input_sha256: "b".repeat(64),
  artifacts: [
    {
      format: "docx" as const,
      path: "/tmp/sztu-export-test/proposal.docx",
      sha256: "c".repeat(64),
      size_bytes: 1234,
    },
    {
      format: "pdf" as const,
      path: "/tmp/sztu-export-test/proposal.pdf",
      sha256: "d".repeat(64),
      size_bytes: 2345,
    },
  ],
  checks: [contentCheck, pdfStructureCheck, cjkGlyphCheck],
  generated_at: "2026-08-30T00:00:03Z",
}

const preflightResult = {
  schema_version: "1.0" as const,
  document_id: "document-fixture",
  document_revision: 2,
  template: exportReceipt.template,
  input_sha256: "b".repeat(64),
  targets: [
    {
      format: "docx" as const,
      filename: "开题报告.docx",
      path: "/tmp/sztu-export-test/开题报告.docx",
      exists: false,
    },
    {
      format: "pdf" as const,
      filename: "开题报告.pdf",
      path: "/tmp/sztu-export-test/开题报告.pdf",
      exists: false,
    },
  ],
  overwrite_required: false,
  preflight_token: "e".repeat(64),
  expires_at: "2026-08-30T00:05:00Z",
}

const previewResult = {
  schema_version: "1.0" as const,
  preview_id: "preview-fixture",
  document_id: "document-fixture",
  document_revision: 2,
  input_sha256: "b".repeat(64),
  template: exportReceipt.template,
  pages: [
    {
      page_number: 1,
      sha256: "9".repeat(64),
      size_bytes: 68,
      data_url: "data:image/png;base64,iVBORw0KGgo=",
    },
  ],
  checks: [contentCheck, pdfStructureCheck, cjkGlyphCheck],
  generated_at: "2026-08-30T00:00:02Z",
}

const historyJob = {
  export_id: "export-fixture",
  request_id: "00000000-0000-4000-8000-000000000001",
  status: "completed" as const,
  progress: 100,
  error_code: null,
  requested_formats: ["docx" as const],
  input_sha256: "b".repeat(64),
  template: exportReceipt.template,
  snapshot_available: true,
  overwrite_confirmed: false,
  artifacts: [
    {
      artifact_id: "artifact-docx-fixture",
      format: "docx" as const,
      display_name: "开题报告.docx",
      sha256: "c".repeat(64),
      size_bytes: 1234,
      file_state: "available" as const,
      replaced_existing: false,
      checks: [docxStructureCheck, pendingTargetEditorCheck],
    },
  ],
  created_at: "2026-08-30T00:00:02Z",
  completed_at: "2026-08-30T00:00:03Z",
}

function documentFixture(
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id: "document-fixture",
    profile_id: profile.id,
    document_type: "proposal",
    template_version: "0.1.0-dev.1",
    schema_version: "0.2",
    title: "合成开题报告",
    status: "draft",
    is_temporary: false,
    current_revision: 2,
    content: draftContent,
    save_reason: "auto",
    saved_at: "2026-08-30T00:00:00Z",
    created_at: "2026-08-30T00:00:00Z",
    updated_at: "2026-08-30T00:00:00Z",
    ...overrides,
  }
}

function taskBookDocumentFixture(
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return documentFixture({
    id: "task-book-document",
    document_type: "task_book",
    template_version: "0.1+46b6d97",
    schema_version: "0.1",
    title: "合成任务书",
    content: {
      metadata: {
        graduation_year: 2026,
        title: "合成任务书题目",
        student_name: "合成学生甲",
        student_id: "SYN-0001",
        college: "示例学院",
        major: "示例专业",
        class_name: "示例一班",
        advisor: "合成教师乙",
      },
      sections: {
        basic_content_and_requirements: [
          "完成统一数据模型和双路文档渲染。",
        ],
        schedule: [
          { period: "2026年11月1日—11月15日", content: "完成文献调研和需求分析。" },
          { period: "2026年11月16日—12月15日", content: "完成系统实现和测试。" },
        ],
        required_materials: [],
        references: ["[1] 合成任务书参考文献。"],
        topic_information: {
          nature: "graduation_design",
          source: {
            type: "research_project",
            research_project: {
              level: "provincial_ministerial",
              project_number: "SYN-PROJECT-001",
            },
          },
        },
      },
    },
    ...overrides,
  })
}

function mockApi(): SztuDesktopApi {
  return {
    downloadThesisTemplate: vi.fn().mockResolvedValue({ saved: true }),
    getAppInfo: vi.fn().mockResolvedValue({
      appVersion: "0.1.0",
      electronVersion: "test",
      platform: "darwin",
    }),
    checkEnvironment: vi.fn().mockResolvedValue(environmentResult),
    prepareDiagnosticReport: vi.fn().mockResolvedValue({
      reportId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1788177600,
      operation: "preview.generate",
      files: [{ name: "renderer-input.json", sizeBytes: 2048 }, { name: "tools/001/stderr.bin", sizeBytes: 64 }],
      missing: ["PDF 未生成"],
      sizeBytes: 4096,
      uploadLimitBytes: 8 * 1024 * 1024,
    }),
    saveDiagnosticReport: vi.fn().mockResolvedValue({ saved: true }),
    sendDiagnosticReport: vi.fn().mockResolvedValue({
      reportId: "11111111-1111-4111-8111-111111111111",
      retentionDays: 30,
    }),
    getPrivacyNoticeStatus: vi.fn().mockResolvedValue({
      noticeVersion: "1.1",
      acknowledged: true,
      acceptedAt: "2026-08-30T00:00:00Z",
      telemetryConfigured: false,
      updateConfigured: false,
      configurationRequired: false,
    }),
    acceptPrivacyNotice: vi.fn().mockResolvedValue({
      noticeVersion: "1.1",
      acknowledged: true,
      acceptedAt: "2026-08-30T00:00:00Z",
      telemetryConfigured: false,
      updateConfigured: false,
      configurationRequired: false,
    }),
    quitApp: vi.fn().mockResolvedValue(null),
    onCloseRequest: vi.fn().mockReturnValue(() => undefined),
    completeCloseRequest: vi.fn().mockResolvedValue({ accepted: true }),
    recordTelemetry: vi.fn().mockResolvedValue(null),
    getAnonymousDocumentCount: vi.fn().mockResolvedValue(1286),
    recordDocumentCompletion: vi.fn().mockResolvedValue({
      recorded: true,
      total: 1287,
    }),
    getUpdateStatus: vi.fn().mockResolvedValue({ state: "unconfigured" }),
    downloadUpdate: vi.fn().mockResolvedValue({ state: "unconfigured" }),
    installUpdate: vi.fn().mockResolvedValue(null),
    getMidtermDatePolicyStatus: vi.fn().mockResolvedValue({ state: "unconfigured", rules: [] }),
    revealDownloadedUpdate: vi.fn().mockResolvedValue(null),
    openToolLink: vi.fn().mockResolvedValue(null),
    importImageAsset: vi.fn().mockResolvedValue(null),
    onUpdateStatus: vi.fn().mockReturnValue(() => undefined),
    onMidtermDatePolicyStatus: vi.fn().mockReturnValue(() => undefined),
    openWorkspace: vi.fn().mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    }),
    listDocuments: vi.fn().mockResolvedValue({ documents: [], profile_id: null, deleted: false, next_cursor: null, has_more: false }),
    saveProfileDraft: vi.fn().mockImplementation(async (profileDraft) => profileDraft),
    saveProfile: vi.fn().mockResolvedValue(profile),
    createProfile: vi.fn(),
    selectProfile: vi.fn(),
    deleteProfile: vi.fn(),
    restoreProfile: vi.fn(),
    createDocument: vi.fn().mockResolvedValue(
      documentFixture({
        id: "new-document",
        profile_id: null,
        current_revision: 0,
        content: null,
        saved_at: null,
        save_reason: null,
      }),
    ),
    selectDocument: vi.fn().mockImplementation(async (documentId: string) => ({
      mode: "persistent" as const,
      profile,
      profile_draft: null,
      document: documentFixture({ id: documentId }),
      documents: [documentFixture({ id: documentId })],
      deleted_documents: [],
    })),
    renameDocument: vi.fn().mockImplementation(async () => ({
      mode: "persistent" as const,
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    })),
    deleteDocument: vi.fn().mockImplementation(async () => ({
      mode: "persistent" as const,
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    })),
    restoreDocument: vi.fn().mockImplementation(async () => ({
      mode: "persistent" as const,
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    })),
    purgeDocument: vi.fn().mockImplementation(async () => ({
      mode: "persistent" as const,
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    })),
    saveDraft: vi.fn().mockResolvedValue({
      document_id: "document-fixture",
      revision: 3,
      save_reason: "auto",
      saved_at: "2026-08-30T00:00:01Z",
    }),
    closeTemporary: vi.fn().mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
      deleted_documents: [],
    }),
    checkDocument: vi.fn().mockResolvedValue({ checks: [contentCheck] }),
    generatePreview: vi.fn().mockResolvedValue(previewResult),
    chooseExportDirectory: vi.fn().mockResolvedValue("/tmp/sztu-export-test"),
    preflightExport: vi.fn().mockImplementation(async (input: ExportPreflightInput) => ({
      ...preflightResult,
      targets: input.formats.map((format) => ({
        format,
        filename: `开题报告.${format === "tex" ? "zip" : format}`,
        path: `/tmp/sztu-export-test/开题报告.${format === "tex" ? "zip" : format}`,
        exists: false,
      })),
    })),
    exportDocument: vi.fn().mockResolvedValue(exportReceipt),
    cancelExport: vi.fn().mockResolvedValue({
      request_id: "00000000-0000-4000-8000-000000000001",
      accepted: true,
      status: "cancel_requested",
      cancel_requested_at: "2026-08-30T00:00:04Z",
    }),
    listExportHistory: vi.fn().mockResolvedValue({
      schema_version: "1.0",
      history: [],
    }),
    revealExportArtifact: vi.fn().mockResolvedValue({
      artifact_id: "artifact-docx-fixture",
      revealed: true,
    }),
    deleteExportHistory: vi.fn().mockResolvedValue({
      export_id: "export-fixture",
      deleted: true,
    }),
    installTemplatePack: vi.fn().mockResolvedValue({
      status: "linked",
      template_id: "sztu.proposal.2026.local",
      version: "0.2+workspace.a0799ee00000",
      pack_sha256: "a".repeat(64),
      installed_at: "2026-08-30T00:00:04Z",
      source: "linked-workspace",
    }),
    recordQa: vi.fn().mockResolvedValue({
      record_id: "qa-record-fixture",
      export_id: "export-fixture",
      artifact_id: "artifact-docx-fixture",
      check: {
        ...contentCheck,
        check_id: "target-editor-manual",
        gate: "target_editor",
        message: "WPS Office 人工验收已记录。",
      },
      recorded_at: "2026-08-30T00:00:05Z",
    }),
  }
}

function installApi(api: SztuDesktopApi) {
  ;(window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop = api
}

function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.mocked(celebrateExportSuccess).mockClear()
  window.localStorage.clear()
  window.localStorage.setItem("sztu-docs.thesis-seeded-v1", "1")
})

function replaceRichText(element: HTMLElement, value: string) {
  element.focus()
  fireEvent.keyDown(element, {
    key: "a",
    code: "KeyA",
    ctrlKey: true,
  })
  if (!value) {
    fireEvent.keyDown(element, { key: "Backspace", code: "Backspace" })
    return
  }
  fireEvent.paste(element, {
    clipboardData: {
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? value : ""),
    },
  })
}

function openComboboxSuggestions(input: HTMLElement) {
  const trigger = input
    .closest('[data-slot="input-group"]')
    ?.querySelector<HTMLButtonElement>("button")
  expect(trigger).not.toBeNull()
  fireEvent.click(trigger!)
}

async function openOperationsPanel() {
  if (!screen.queryByRole("button", { name: "导出记录" })) {
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    )
  }
  fireEvent.click(
    await screen.findByRole("button", { name: "导出记录" }),
  )
}

async function openSharedThesisTitle() {
  if (!screen.queryByRole("button", { name: "档案与基本信息" })) {
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    )
  }
  fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
  return screen.findByRole("textbox", { name: "中文题目" })
}

async function generateCurrentPreview(api: SztuDesktopApi) {
  fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
  await waitFor(() =>
    expect(api.generatePreview).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "document-fixture",
    }),
  )
  expect(
    await screen.findByRole("img", { name: "排版预览第 1 页" }),
  ).toBeInTheDocument()
}

function closePreviewDrawer() {
  const closeButton = document.querySelector<HTMLElement>(
    '[data-slot="sheet-close"]',
  )
  if (closeButton) {
    fireEvent.click(closeButton)
    return
  }

  const backdrop = document.querySelector<HTMLElement>(
    '[data-slot="sheet-overlay"]',
  )
  if (backdrop) {
    fireEvent.mouseDown(backdrop, { button: 0 })
    fireEvent.mouseUp(backdrop, { button: 0 })
    fireEvent.click(backdrop)
  }
}

function closePreviewDrawerFromBackdrop() {
  const backdrop = document.querySelector<HTMLElement>(
    '[data-slot="sheet-overlay"]',
  )
  expect(backdrop).not.toBeNull()
  fireEvent.mouseDown(backdrop!, { button: 0 })
  fireEvent.mouseUp(backdrop!, { button: 0 })
  fireEvent.click(backdrop!)
}

describe("M3 workbench persistence", () => {
  it("notifies about an update and downloads only on click, with a later sidebar entry", async () => {
    const api = mockApi()
    vi.mocked(api.getUpdateStatus).mockResolvedValue({ state: "available", version: "0.2.0", sizeBytes: 375095528 })
    vi.mocked(api.downloadUpdate).mockResolvedValue({ state: "downloaded", version: "0.2.0", downloadedAt: "2026-10-05T00:00:00Z" })
    installApi(api)
    renderApp()
    const notice = await screen.findByRole("dialog", { name: "发现新版本" })
    expect(within(notice).getByText(/376 MB/)).toBeInTheDocument()
    expect(api.downloadUpdate).not.toHaveBeenCalled()
    fireEvent.click(within(notice).getByRole("button", { name: "稍后处理" }))
    if (!screen.queryByRole("button", { name: "新版本可用" })) fireEvent.click(await screen.findByRole("button", { name: "Toggle Sidebar" }))
    fireEvent.click(await screen.findByRole("button", { name: "新版本可用" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "发现新版本" })).getByRole("button", { name: "下载更新" }))
    expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
    const downloaded = await screen.findByRole("dialog", { name: "更新已就绪" })
    fireEvent.click(within(downloaded).getByRole("button", { name: "显示更新文件" }))
    expect(api.revealDownloadedUpdate).toHaveBeenCalledTimes(1)
  })

  it("installs a downloaded update only after the user confirms", async () => {
    const api = mockApi()
    vi.mocked(api.getUpdateStatus).mockResolvedValue({
      state: "downloaded",
      version: "0.2.0",
      downloadedAt: "2026-10-05T00:00:00Z",
    })
    installApi(api)
    renderApp()

    const downloaded = await screen.findByRole("dialog", { name: "更新已就绪" })
    fireEvent.click(within(downloaded).getByRole("button", { name: "安装并重启" }))
    expect(api.installUpdate).not.toHaveBeenCalled()

    const confirm = await screen.findByRole("dialog", { name: "安装更新并重启" })
    fireEvent.click(within(confirm).getByRole("button", { name: "保存并安装" }))
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledTimes(1))
  })

  it("allows required update download retries instead of leaving the blocking notice waiting", async () => {
    const api = mockApi()
    const control = { updatePolicy: "required" as const, minimumSupportedVersion: "0.2.0", requiresUpgrade: true, serviceStatus: "normal" as const, helpUrl: null, announcement: null }
    vi.mocked(api.getUpdateStatus).mockResolvedValue({ state: "available", version: "0.2.0", sizeBytes: 1000, control })
    vi.mocked(api.downloadUpdate).mockResolvedValue({ state: "available", version: "0.2.0", sizeBytes: 1000, downloadFailed: true, control })
    installApi(api)
    renderApp()
    const notice = await screen.findByRole("dialog", { name: "需要更新后继续使用" })
    fireEvent.click(within(notice).getByRole("button", { name: "下载更新" }))
    expect(await within(notice).findByRole("button", { name: "重试下载" })).toBeEnabled()
    expect(within(notice).getByText(/下载失败/)).toBeInTheDocument()
  })

  it("installs a downloaded required update from the blocking notice after confirmation", async () => {
    const api = mockApi()
    const control = { updatePolicy: "required" as const, minimumSupportedVersion: "0.2.0", requiresUpgrade: true, serviceStatus: "normal" as const, helpUrl: null, announcement: null }
    vi.mocked(api.getUpdateStatus).mockResolvedValue({
      state: "downloaded",
      version: "0.2.0",
      downloadedAt: "2026-10-05T00:00:00Z",
      control,
    })
    installApi(api)
    renderApp()

    const notice = await screen.findByRole("dialog", { name: "需要更新后继续使用" })
    fireEvent.click(within(notice).getByRole("button", { name: "安装并重启" }))
    expect(api.installUpdate).not.toHaveBeenCalled()

    const confirm = await screen.findByRole("dialog", { name: "安装更新并重启" })
    fireEvent.click(within(confirm).getByRole("button", { name: "保存并安装" }))
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledTimes(1))
  })

  beforeEach(() => {
    installApi(mockApi())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    })
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })

  it.each([false, true])("opens the workbench without a privacy gate when configurationRequired=%s", async (configurationRequired) => {
    window.localStorage.clear()
    const api = mockApi()
    vi.mocked(api.getPrivacyNoticeStatus).mockResolvedValue({
      noticeVersion: "1.2",
      acknowledged: false,
      acceptedAt: null,
      telemetryConfigured: false,
      updateConfigured: false,
      configurationRequired,
    })
    installApi(api)
    renderApp()

    await screen.findByLabelText("保存状态：已保存")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByLabelText("本选题的意义及国内外发展状况")).toBeEnabled()
    expect(api.getPrivacyNoticeStatus).not.toHaveBeenCalled()
    expect(api.acceptPrivacyNotice).not.toHaveBeenCalled()
    expect(api.quitApp).not.toHaveBeenCalled()
    expect(api.getUpdateStatus).toHaveBeenCalled()
    expect(api.getMidtermDatePolicyStatus).toHaveBeenCalled()
  })

  it("keeps the workbench usable and loads date policy when update status is unavailable", async () => {
    window.localStorage.clear()
    const api = mockApi()
    vi.mocked(api.getUpdateStatus).mockRejectedValue(new Error("Update service unavailable"))
    installApi(api)
    renderApp()

    await screen.findByLabelText("保存状态：已保存")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(api.getMidtermDatePolicyStatus).toHaveBeenCalled()
    expect(api.acceptPrivacyNotice).not.toHaveBeenCalled()
    expect(api.quitApp).not.toHaveBeenCalled()
  })

  it("shows live download progress and keeps downloading when the dialog is dismissed", async () => {
    const api = mockApi()
    vi.mocked(api.getUpdateStatus).mockResolvedValue({ state: "downloading", version: "0.2.0", downloadedBytes: 25_000_000, sizeBytes: 100_000_000, phase: "transferring" })
    installApi(api)
    renderApp()
    const dialog = await screen.findByRole("dialog", { name: "下载更新" })
    expect(within(dialog).getByRole("progressbar", { name: "下载进度" })).toHaveAttribute("aria-valuenow", "25")
    expect(within(dialog).getByText("25.0 MB / 100.0 MB")).toBeInTheDocument()
    expect(within(dialog).queryByText(/收起后会继续下载/)).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole("button")).toHaveLength(1)
    const listener = vi.mocked(api.onUpdateStatus).mock.calls[0]![0]
    act(() => listener({ state: "downloading", version: "0.2.0", downloadedBytes: 60_000_000, sizeBytes: 100_000_000, phase: "transferring" }))
    expect(within(dialog).getByRole("progressbar", { name: "下载进度" })).toHaveAttribute("aria-valuenow", "60")
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "下载更新" })).not.toBeInTheDocument())
    expect(api.downloadUpdate).not.toHaveBeenCalled()
  })

  it("keeps the setup check available on demand without opening it on launch", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValueOnce({
      ...environmentResult,
      ready: false,
      checks: [{ id: "xelatex", required: true, status: "fail", message: "未找到 XeLaTeX。" }],
    })
    installApi(api)
    renderApp()

    await screen.findByLabelText("保存状态：已保存")
    expect(screen.queryByRole("dialog", { name: "环境检查" })).not.toBeInTheDocument()
    await openOperationsPanel()
    fireEvent.click(await screen.findByRole("button", { name: "查看环境修复指引" }))

    const dialog = await screen.findByRole("dialog", { name: "环境检查" })
    fireEvent.click(within(dialog).getByRole("button", { name: "重新检查" }))
    expect(await within(dialog).findByText("基础环境可用")).toBeInTheDocument()
    expect(within(dialog).getByText("XeLaTeX")).toBeInTheDocument()
    expect(within(dialog).queryByText("XeLaTeX is available.")).toBeNull()
    expect(dialog.querySelector('[data-slot="badge"]')).toBeNull()
    expect(dialog.querySelector('[data-slot="section-completion-mark"]')).toHaveAttribute("data-animate", "true")

    fireEvent.click(within(dialog).getByRole("button", { name: "返回工作台" }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it("offers an installation guide when the user opens the check with a missing component", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue({
      ...environmentResult,
      ready: false,
      checks: [
        ...environmentResult.checks,
        {
          id: "xelatex",
          required: true,
          status: "fail",
          message: "未找到 xelatex 可执行文件。",
        },
      ],
    })
    installApi(api)

    renderApp()
    await screen.findByLabelText("保存状态：已保存")
    expect(screen.queryByRole("dialog", { name: "环境检查" })).not.toBeInTheDocument()
    await openOperationsPanel()
    fireEvent.click(await screen.findByRole("button", { name: "查看环境修复指引" }))

    const dialog = await screen.findByRole("dialog", {
      name: "环境检查",
    })
    expect(within(dialog).getByText("缺少 1 项必要组件")).toBeInTheDocument()

    fireEvent.click(
      within(dialog).getByRole("button", { name: "打开 TeX 安装页面" }),
    )
    expect(api.openToolLink).toHaveBeenCalledWith("mactex")

    fireEvent.click(within(dialog).getByRole("button", { name: "返回工作台" }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it("creates one thesis document when the workspace has none yet", async () => {
    window.localStorage.clear()
    const api = mockApi()
    const thesis = documentFixture({ id: "seeded-thesis", document_type: "thesis", title: "合成学生甲-毕业论文", content: null, current_revision: 0 })
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profiles: [profile],
      profile_draft: null,
      document: null,
      documents: [],
      deleted_documents: [],
    })
    vi.mocked(api.createDocument).mockResolvedValue(thesis)
    installApi(api)
    renderApp()
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith({
      profile_id: profile.id,
      document_type: "thesis",
      template_version: "0.1.0-authoring",
      schema_version: "0.1",
      title: "合成学生甲-毕业论文",
    }))
  })

  it("downloads the bundled thesis template without changing the document or requiring a preview", async () => {
    const api = mockApi()
    const thesis = documentFixture({ id: "thesis-fixture", document_type: "thesis", title: "合成学生甲-毕业论文", content: null, current_revision: 0 })
    vi.mocked(api.createDocument).mockResolvedValue(thesis)
    vi.mocked(api.selectDocument).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: thesis, documents: [documentFixture(), thesis] })
    installApi(api)
    renderApp()
    const createButton = await screen.findByRole("button", { name: "新建毕业论文" })
    const layout = screen.getByRole("button", { name: "排版工具" })
    const trash = screen.getByRole("button", { name: /回收站（/ })
    expect(layout.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(createButton)
    const dialog = await screen.findByRole("dialog", { name: "新建毕业论文" })
    fireEvent.click(within(dialog).getByRole("button", { name: "新建" }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith(expect.objectContaining({ document_type: "thesis", title: "合成学生甲-毕业论文" })))
    expect(await screen.findByRole("heading", { name: "毕业论文" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "毕业论文" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "合成学生甲-毕业论文" })).toBeInTheDocument()
    const thesisSections = within(screen.getByRole("navigation", { name: "当前文档板块" })).getAllByRole("button")
    expect(thesisSections.map(button => button.firstElementChild?.textContent)).toEqual(["LaTeX 模板"])
    const download = screen.getByRole("button", { name: "下载 LaTeX 模板" })
    expect(download).toBeEnabled()
    const notify = vi.spyOn(toast, "success")
    fireEvent.click(download)
    await waitFor(() => expect(api.downloadThesisTemplate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(notify).toHaveBeenCalledWith("LaTeX 模板已保存，解压后打开 README.md 开始使用。"))
    expect(screen.queryByRole("button", { name: "预览&导出" })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "章节正文" })).not.toBeInTheDocument()
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(api.generatePreview).not.toHaveBeenCalled()
  })

  it("opens an existing thesis record without rewriting its saved draft", async () => {
    const api = mockApi()
    const thesis = documentFixture({ id: "thesis-fixture", document_type: "thesis", content: { thesis: { ...emptyThesisDraft(), abstractCn: ["已保存的合成摘要"], chapters: [{ id: "stable-chapter", title: "合成章节", level: 1, body: ["已保存的章节正文"] }] } } })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: thesis, documents: [thesis] })
    installApi(api)
    renderApp()
    expect(await screen.findByRole("heading", { name: "毕业论文" })).toBeInTheDocument()
    expect(screen.getByText("下载后解压，在 LaTeX 编辑器或 Agent 中打开工程文件夹。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下载 LaTeX 模板" })).toBeEnabled()
    expect(screen.queryByRole("textbox", { name: "章节正文" })).not.toBeInTheDocument()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it.each(["cancel", "failure"])("handles template download %s and allows retry", async (outcome) => {
    const api = mockApi()
    const thesis = documentFixture({ document_type: "thesis", content: null })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: null, profile_draft: null, document: thesis, documents: [thesis] })
    let resolve!: (value: { saved: boolean }) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<{ saved: boolean }>((complete, fail) => { resolve = complete; reject = fail })
    const pending = { promise, resolve, reject }
    vi.mocked(api.downloadThesisTemplate).mockReturnValueOnce(pending.promise)
    const success = vi.spyOn(toast, "success")
    const failure = vi.spyOn(toast, "error")
    installApi(api)
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "下载 LaTeX 模板" }))
    expect(screen.getByRole("button", { name: "正在保存模板…" })).toBeDisabled()
    if (outcome === "cancel") pending.resolve({ saved: false })
    else pending.reject(new Error("模板未保存"))
    await waitFor(() => expect(screen.getByRole("button", { name: "下载 LaTeX 模板" })).toBeEnabled())
    expect(success).not.toHaveBeenCalled()
    if (outcome === "failure") expect(failure).toHaveBeenCalledWith("模板未保存")
    fireEvent.click(screen.getByRole("button", { name: "下载 LaTeX 模板" }))
    await waitFor(() => expect(api.downloadThesisTemplate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(api.generatePreview).not.toHaveBeenCalled()
  })

  it("keeps thesis authoring and document export closed while allowing template download", async () => {
    const api = mockApi()
    const thesis = documentFixture({
      id: "thesis-reference-fixture",
      document_type: "thesis",
      content: { thesis: emptyThesisDraft() },
    })
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: thesis,
      documents: [thesis],
    })
    installApi(api)
    renderApp()

    const navigation = await screen.findByRole("navigation", { name: "当前文档板块" })
    expect(within(navigation).getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "添加第一条参考文献" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "预览&导出" })).not.toBeInTheDocument()
    expect(api.generatePreview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "导出记录" }))
    expect(await screen.findByText("当前文档暂不支持预览和导出。")).toBeInTheDocument()
  })

  it("shows the thesis title editor without the redundant title fields", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    expect(await screen.findByRole("textbox", { name: "中文题目" })).toBeInTheDocument()
    expect(screen.queryByText("中文题目")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("英文题目")).not.toBeInTheDocument()
  })

  it("restores the active persistent profile and document", async () => {
    renderApp()

    const savedStatus = await screen.findByLabelText("保存状态：已保存")
    expect(savedStatus).toHaveClass("text-muted-foreground")
    expect(savedStatus.closest('[data-slot="editor-status-footer"]')).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "预览&导出" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("尚未生成预览")).not.toBeInTheDocument()
    expect(screen.queryByText("本机环境")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "预览&导出" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
    const profileHeader = screen.getByRole("heading", { level: 1, name: "基本信息" }).closest("header")
    expect(within(profileHeader as HTMLElement).getByLabelText("保存状态：已保存")).toHaveClass("bg-emerald-500")
  })

  it("uses the official dashboard shell composition", async () => {
    const { container } = renderApp()

    await screen.findByRole("button", { name: "预览&导出" })
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      "data-variant",
      "inset",
    )
    const sidebarWrapper = container.querySelector<HTMLElement>(
      '[data-slot="sidebar-wrapper"]',
    )
    expect(sidebarWrapper?.style.getPropertyValue("--sidebar-width")).toBe("14rem")
    expect(sidebarWrapper).toHaveClass("h-svh", "min-h-0", "overflow-hidden")

    const sidebarInset = container.querySelector<HTMLElement>(
      '[data-slot="sidebar-inset"]',
    )
    expect(sidebarInset).toBeInTheDocument()
    expect(sidebarInset).toHaveClass("min-h-0", "overflow-hidden")
    expect(sidebarInset).not.toHaveClass("h-svh")
    expect(
      screen.getByRole("heading", { level: 1, name: "开题报告" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("本地工作台")).not.toBeInTheDocument()
    expect(screen.queryByText("可用")).not.toBeInTheDocument()
    expect(screen.queryByText("待接入")).not.toBeInTheDocument()
    expect(screen.queryByText("数据默认仅保存在本机")).not.toBeInTheDocument()
    expect(
      await screen.findByText((_, element) =>
        element?.tagName === "P" &&
        element.textContent?.replace(/\s+/g, " ").trim() ===
          "已帮助生成 1,286 份过程文档",
      ),
    ).toBeInTheDocument()
    const thesisFolder = screen.getByRole("button", { name: "排版工具" })
    expect(thesisFolder).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(thesisFolder)
    expect(thesisFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "三线表生成器" })).toBeInTheDocument()
    expect(container.querySelector("header")).toBeNull()
    const toolbar = screen.getByRole("toolbar", { name: /格式工具栏/ })
    expect(within(toolbar).queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(within(toolbar).getByRole("button", { name: "预览&导出" })).toHaveClass(
      "bg-primary",
      "text-primary-foreground",
    )
    const editorFooter = container.querySelector<HTMLElement>('[data-slot="editor-status-footer"]')
    expect(editorFooter).not.toBeNull()
    expect(within(editorFooter!).getByLabelText("保存状态：已保存")).toHaveClass("text-muted-foreground")
    expect(within(editorFooter!).getByRole("button", { name: /查看内容统计/ })).toBeInTheDocument()
    expect(toolbar.querySelector('[data-slot="document-toolbar-actions"]')).toHaveClass("flex", "shrink-0", "items-center")
    expect(within(toolbar).queryByRole("button", { name: "导出" })).not.toBeInTheDocument()
    const sectionNavigation = screen.getByRole("navigation", {
      name: "当前文档板块",
    }).closest('[data-slot="document-section-nav"]')
    expect(sectionNavigation).toHaveClass(
      "w-40",
      "shrink-0",
    )
    const sectionHeader = sectionNavigation?.querySelector('[data-slot="document-section-header"]')
    expect(within(sectionHeader as HTMLElement).getByRole("button", { name: "Toggle Sidebar" })).toBeInTheDocument()
    expect(sectionHeader).not.toHaveTextContent("文档板块")
    expect(
      sectionNavigation?.querySelector('[data-slot="document-section-header"]'),
    ).toHaveClass("h-(--header-height)", "items-center")
    expect(
      container.querySelector('[data-slot="resizable-handle"]'),
    ).not.toBeInTheDocument()
    const immersiveTextbox = await screen.findByRole("textbox", {
      name: "本选题的意义及国内外发展状况",
    })
    expect(
      screen.getByRole("toolbar", {
        name: "本选题的意义及国内外发展状况格式工具栏",
      }),
    ).toHaveClass("h-(--header-height)")
    expect(immersiveTextbox.closest('[data-slot="card"]')).toBeNull()
    const immersiveSurface = immersiveTextbox.closest(
      '[data-slot="immersive-writing-surface"]',
    )
    expect(immersiveSurface).toHaveClass("min-h-0", "flex-1")
    expect(
      immersiveSurface?.querySelectorAll('[data-slot="scroll-area"]'),
    ).toHaveLength(1)
    expect(
      screen.queryByRole("heading", { level: 1, name: "2026届开题报告" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("本选题的意义及国内外发展状况"),
    ).toHaveClass("sr-only")
    expect(
      screen.getByText("请分别说明选题意义和国内外发展状况，至少填写两个段落。"),
    ).toHaveClass("sr-only")
    expect(screen.queryByRole("button", { name: "预览与检查" })).not.toBeInTheDocument()
    fireEvent.click(within(sectionNavigation as HTMLElement).getByRole("button", { name: /参考文献/ }))
    const actionBar = container.querySelector<HTMLElement>('[data-slot="document-action-bar"]')
    expect(actionBar).not.toBeNull()
    expect(within(actionBar!).queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(within(actionBar!).getByRole("button", { name: "预览&导出" })).toBeInTheDocument()
    const referenceFooter = container.querySelector<HTMLElement>('[data-slot="reference-status-footer"]')
    expect(referenceFooter).not.toBeNull()
    expect(within(referenceFooter!).getByLabelText("保存状态：已保存")).toBeInTheDocument()
    expect(within(referenceFooter!).getByRole("button", { name: /查看内容统计/ })).toBeInTheDocument()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
  })

  it("opens the tool directory from the application sidebar", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    for (const label of ["效率工具", "主题外观", "联系作者", "导出记录"]) {
      expect(await screen.findByRole("button", { name: label })).toHaveClass("pl-8")
    }
    fireEvent.click(await screen.findByRole("button", { name: "效率工具" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "效率工具" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { level: 2, name: "效率工具" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/集中打开毕业论文写作常用的网站/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { level: 3, name: "效率工具" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "浏览器扩展" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "文献管理" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "AI 工具" })).toBeInTheDocument()
    expect(screen.queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("navigation", { name: "当前文档板块" }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "打开 Xmind" }))
    await waitFor(() => expect(api.openToolLink).toHaveBeenCalledWith("xmind"))
  })

  it("opens all three generators in the thesis workbench structure", async () => {
    installApi(mockApi())
    renderApp()

    const thesisFolder = await screen.findByRole("button", { name: "排版工具" })
    fireEvent.click(thesisFolder)
    fireEvent.click(screen.getByRole("button", { name: "三线表生成器" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "排版工具" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("main", { name: "三线表生成器" })).toBeInTheDocument()
    const thesisSectionNavigation = screen.getByRole("navigation", {
      name: "当前文档板块",
    })
    expect(
      within(thesisSectionNavigation).getByRole("button", { name: "三线表生成器" }),
    ).toHaveAttribute("aria-current", "page")
    const expectSaveStatusInFooter = (toolTitle: string, stateLabel = "已保存") => {
      const workbenchHeader = screen
        .getByRole("heading", { level: 1, name: "排版工具" })
        .closest("header")
      const toolMain = screen.getByRole("main", { name: toolTitle })
      const footer = document.querySelector<HTMLElement>('[data-slot="save-status-footer"]')

      expect(workbenchHeader).not.toBeNull()
      expect(within(workbenchHeader as HTMLElement).queryByLabelText(/^保存状态：/)).not.toBeInTheDocument()
      expect(footer).not.toBeNull()
      expect(within(footer!).getByLabelText(`保存状态：${stateLabel}`)).toHaveClass("text-muted-foreground")
      expect(within(toolMain).queryByLabelText(/^保存状态：/)).not.toBeInTheDocument()
      expect(screen.getAllByLabelText(/^保存状态：/)).toHaveLength(1)
    }
    expectSaveStatusInFooter("三线表生成器")
    fireEvent.change(screen.getByLabelText("表题（可选）"), {
      target: { value: "保存状态位置测试" },
    })
    await waitFor(() => expectSaveStatusInFooter("三线表生成器", "未保存"))
    await waitFor(() => expectSaveStatusInFooter("三线表生成器"))
    expect(screen.queryByRole("button", { name: "检查内容" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "预览&导出" })).not.toBeInTheDocument()

    fireEvent.click(
      within(thesisSectionNavigation).getByRole("button", { name: "表格生成器" }),
    )
    expect(screen.getByRole("main", { name: "表格生成器" })).toBeInTheDocument()
    expect(
      within(thesisSectionNavigation).getByRole("button", { name: "表格生成器" }),
    ).toHaveAttribute("aria-current", "page")
    expectSaveStatusInFooter("表格生成器")

    fireEvent.click(
      within(thesisSectionNavigation).getByRole("button", { name: "多图排版" }),
    )
    expect(screen.getByRole("main", { name: "多图排版" })).toBeInTheDocument()
    expectSaveStatusInFooter("多图排版")
  })

  it("shows the local maintainer contact without a feedback backend", async () => {
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "联系作者" }))

    const dialog = await screen.findByRole("dialog", { name: "联系作者" })
    expect(
      within(dialog).getByRole("img", { name: "作者微信二维码" }),
    ).toHaveAttribute("src", expect.stringContaining("maintainer-wechat-qr"))
    const latexSentence = within(dialog).getByLabelText(
      "欢迎交流 LaTeX 排版经验和提交问题反馈！",
    )
    expect(latexSentence.querySelector('[data-slot="latex-wordmark"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    expect(within(dialog).getByText("添加时请备注年级、学院、专业和姓名～")).toBeInTheDocument()
    expect(within(dialog).queryByText(/软件不会自动上传文档或问题内容/)).toBeNull()
    expect(within(dialog).queryByRole("button", { name: /复制 QQ/ })).toBeNull()
  })

  it("keeps document-section navigation visible when the app sidebar collapses at minimum width", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1100,
    })
    const { container } = renderApp()

    const sectionNavigation = (
      await screen.findByRole("navigation", { name: "当前文档板块" })
    ).closest('[data-slot="document-section-nav"]')
    expect(sectionNavigation).toHaveClass("w-40", "shrink-0")
    expect(
      screen.queryByRole("combobox", { name: "选择文档板块" }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    expect(
      container.querySelector('[data-slot="document-section-nav"]'),
    ).toBe(sectionNavigation)
    expect(
      within(sectionNavigation!).getByRole("button", { name: "研究内容已填写" }),
    ).toBeEnabled()
  })

  it("keeps profile suggestions editable and applies the selected cohort to workspace titles", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const advisorTitle = screen.getByLabelText("指导教师职称")
    const graduationCohort = screen.getByLabelText("毕业届别")
    openComboboxSuggestions(advisorTitle)
    fireEvent.click(await screen.findByRole("option", { name: "教授" }))
    expect(advisorTitle).toHaveValue("教授")
    fireEvent.change(graduationCohort, { target: { value: "" } })
    openComboboxSuggestions(graduationCohort)
    fireEvent.keyDown(graduationCohort, { key: "ArrowUp" })
    fireEvent.keyDown(graduationCohort, { key: "Enter" })
    expect(graduationCohort).toHaveValue("2028届")

    fireEvent.change(advisorTitle, { target: { value: "讲师" } })
    fireEvent.change(graduationCohort, { target: { value: "秋季毕业批次" } })
    expect(advisorTitle).toHaveValue("讲师")
    expect(graduationCohort).toHaveValue("秋季毕业批次")
    await waitFor(
      () =>
        expect(api.saveProfileDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            advisor_name: "合成教师乙",
            advisor_title: "讲师",
            graduation_cohort: "秋季毕业批次",
          }),
          profile.id,
        ),
      { timeout: 2_000 },
    )
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        advisor_name: "合成教师乙",
        advisor_title: "讲师",
        graduation_cohort: "秋季毕业批次",
      }),
    )
    expect(api.saveDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "合成开题报告" }))
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "开题报告",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText("秋季毕业批次开题报告")).not.toBeInTheDocument()
  })

  it("keeps multiple advisors paired with their titles in the shared profile form", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const advisorGroup = screen.getByRole("group", { name: "指导信息" })
    expect(within(advisorGroup).getByRole("button", { name: "添加指导教师" })).toBeEnabled()
    expect(within(advisorGroup).getByRole("button", { name: "删除指导教师" })).toBeDisabled()
    const firstTitle = within(advisorGroup).getByLabelText("指导教师职称")
    openComboboxSuggestions(firstTitle)
    for (const option of [
      "教授",
      "副教授",
      "助理教授",
      "特聘教授",
      "讲师",
      "高级工程师",
      "副研究员",
      "专职副研究员",
      "实验师",
    ]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument()
    }
    fireEvent.keyDown(firstTitle, { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "添加指导教师" }))
    fireEvent.change(screen.getByLabelText("第2指导教师"), {
      target: { value: "合成教师丙" },
    })
    const secondTitle = screen.getByLabelText("第2指导教师职称")
    openComboboxSuggestions(secondTitle)
    fireEvent.click(screen.getByRole("option", { name: "实验师" }))
    expect(screen.queryByRole("button", { name: /^(上移|下移).*指导教师$/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "删除指导教师" })).toBeEnabled()
    expect(screen.getByLabelText("指导教师")).toHaveValue("合成教师乙")
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("副教授")
    expect(screen.getByLabelText("第2指导教师")).toHaveValue("合成教师丙")
    expect(screen.getByLabelText("第2指导教师职称")).toHaveValue("实验师")

    await waitFor(
      () =>
        expect(api.saveProfileDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            advisor_name: "合成教师乙、合成教师丙",
            advisor_title: "副教授、实验师",
          }),
          profile.id,
        ),
      { timeout: 2_000 },
    )
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        advisor_name: "合成教师乙、合成教师丙",
        advisor_title: "副教授、实验师",
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: "添加指导教师" }))
    expect(screen.getByLabelText("第3指导教师")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "删除指导教师" }))
    expect(screen.queryByLabelText("第3指导教师")).not.toBeInTheDocument()
    expect(screen.getByLabelText("第2指导教师")).toHaveValue("合成教师丙")
    expect(screen.getByLabelText("第2指导教师职称")).toHaveValue("实验师")

    fireEvent.click(screen.getByRole("button", { name: "删除指导教师" }))
    expect(screen.queryByLabelText("第2指导教师")).not.toBeInTheDocument()
    expect(screen.getByLabelText("指导教师")).toHaveValue("合成教师乙")
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("副教授")
    expect(screen.getByRole("button", { name: "删除指导教师" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "删除指导教师" }))
    expect(screen.getByLabelText("指导教师")).toHaveValue("合成教师乙")
    await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ advisor_name: "合成教师乙", advisor_title: "副教授" }),
    ), { timeout: 2_000 })
    expect(api.saveProfileDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ advisor_name: "合成教师乙", advisor_title: "副教授" }),
      profile.id,
    )
  })

  it("normalizes only plain four-digit cohorts and enforces the 20-character boundary", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const graduationCohort = screen.getByLabelText("毕业届别")
    expect(graduationCohort).toHaveAttribute("maxlength", "20")
    vi.useFakeTimers()

    const saveCohort = async (
      inputValue: string,
      expectedDraftValue: string,
      expectedProfileValue: string,
    ) => {
      vi.mocked(api.saveProfileDraft).mockClear()
      vi.mocked(api.saveProfile).mockClear()
      fireEvent.change(graduationCohort, { target: { value: inputValue } })
      await act(async () => vi.advanceTimersByTimeAsync(700))

      expect(graduationCohort).toHaveValue(expectedDraftValue)
      expect(api.saveProfileDraft).toHaveBeenCalledWith(
        expect.objectContaining({ graduation_cohort: expectedDraftValue }),
        profile.id,
      )
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({ graduation_cohort: expectedProfileValue }),
      )
    }

    await saveCohort("2031", "2031", "2031届")
    await saveCohort("A".repeat(19), "A".repeat(19), "A".repeat(19))
    await saveCohort("B".repeat(20), "B".repeat(20), "B".repeat(20))
    await saveCohort("C".repeat(21), "C".repeat(20), "C".repeat(20))
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("filters major and class suggestions while preserving custom profile values", async () => {
    const catalogCollege = ACADEMIC_OPTIONS.find((college) =>
      college.majors.some((major) => major.classes.length > 0),
    )
    const catalogMajor = catalogCollege?.majors.find(
      (major) => major.classes.length > 0,
    )
    expect(catalogCollege).toBeDefined()
    expect(catalogMajor).toBeDefined()

    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const collegeInput = screen.getByLabelText("学院")
    let majorInput = screen.getByLabelText("专业")
    let classInput = screen.getByLabelText("班级")

    fireEvent.change(collegeInput, { target: { value: "" } })
    openComboboxSuggestions(collegeInput)
    fireEvent.click(
      await screen.findByRole("option", { name: catalogCollege!.college }),
    )
    majorInput = screen.getByLabelText("专业")
    classInput = screen.getByLabelText("班级")
    expect(majorInput).toHaveValue("")
    expect(classInput).toHaveValue("")
    openComboboxSuggestions(majorInput)
    expect(
      await screen.findByRole("option", { name: catalogMajor!.major }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: catalogMajor!.major }))
    classInput = screen.getByLabelText("班级")
    openComboboxSuggestions(classInput)
    expect(
      await screen.findByRole("option", { name: catalogMajor!.classes[0] }),
    ).toBeInTheDocument()
    fireEvent.change(classInput, { target: { value: "自定义班级" } })
    fireEvent.change(majorInput, { target: { value: "自定义专业" } })
    classInput = screen.getByLabelText("班级")
    expect(classInput).toHaveValue("")

    fireEvent.change(classInput, { target: { value: "自定义班级" } })
    expect(majorInput).toHaveValue("自定义专业")
    expect(classInput).toHaveValue("自定义班级")

    fireEvent.change(collegeInput, { target: { value: "自定义学院" } })
    majorInput = screen.getByLabelText("专业")
    classInput = screen.getByLabelText("班级")
    expect(collegeInput).toHaveValue("自定义学院")
    expect(majorInput).toHaveValue("")
    expect(classInput).toHaveValue("")
  })

  it("removes a legacy grade prefix from the stored class display and next profile save", async () => {
    const api = mockApi()
    const legacyProfile = {
      ...profile,
      college: "新材料与新能源学院",
      major: "新能源科学与工程",
      class_name: "23级新能源2班",
    }
    const activeDocument = documentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile: legacyProfile,
      profile_draft: {
        ...completeProfileDraft,
        college: legacyProfile.college,
        major: legacyProfile.major,
        class_name: "2023级新能源2班",
      },
      document: activeDocument,
      documents: [activeDocument],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    expect(screen.getByLabelText("班级")).toHaveValue("新能源2班")

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "教授" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith(
      expect.objectContaining({ class_name: "新能源2班" }),
      profile.id,
    )
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ class_name: "新能源2班" }),
    )
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("opens checks from the sidebar without reserving preview space on narrow windows", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 600,
    })
    renderApp()

    await openOperationsPanel()

    expect(
      screen.getByRole("heading", { level: 1, name: "导出记录" }),
    ).toBeInTheDocument()
    const inspectionFooter = document.querySelector<HTMLElement>('[data-slot="save-status-footer"]')
    expect(inspectionFooter).not.toBeNull()
    expect(within(inspectionFooter!).getByLabelText("保存状态：已保存")).toBeInTheDocument()
    expect(screen.getByText("当前状态")).toBeInTheDocument()
    expect(screen.queryByText("文档质量")).not.toBeInTheDocument()
    expect(screen.queryByText("Python 3.14.4 is supported.")).not.toBeInTheDocument()
    expect(screen.getByText("故障诊断包")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建诊断包" })).toBeInTheDocument()
    expect(screen.queryByText("高级信息与故障诊断")).not.toBeInTheDocument()
    expect(screen.queryByText("本机环境")).not.toBeInTheDocument()
    expect(screen.queryByText("尚未生成预览")).not.toBeInTheDocument()
    expect(screen.queryByText("预览与检查")).not.toBeInTheDocument()

    // Narrow screens close the navigation sheet after choosing an item.
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
    fireEvent.click(await screen.findByRole("button", { name: "合成开题报告" }))
    expect(
      (await screen.findAllByRole("heading", {
        level: 1,
        name: "开题报告",
      })).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole("textbox", { name: "中文题目" })).toBeNull()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
  })

  it("creates and saves a full diagnostic package from the only entry", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await openOperationsPanel()
    expect(screen.queryByRole("button", { name: "发送诊断包" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "查看完整故障包" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "创建诊断包" }))

    expect(
      await screen.findByRole("dialog", { name: "诊断包" }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/renderer-input.json/)).toBeInTheDocument()
    expect(screen.getByText(/4\.0 KB/)).toBeInTheDocument()
    expect(screen.getByText("PDF 未生成")).toBeInTheDocument()
    expect(api.sendDiagnosticReport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "保存到本机" }))
    await waitFor(() =>
      expect(api.saveDiagnosticReport).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      ),
    )
    expect(await screen.findByText("已保存到你选择的位置。")).toBeInTheDocument()
  })

  it("sends the reviewed full diagnostic package on explicit user action", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "创建诊断包" }))
    const report = await screen.findByRole("dialog", { name: "诊断包" })
    await within(report).findByText(/renderer-input.json/)
    expect(api.sendDiagnosticReport).not.toHaveBeenCalled()
    fireEvent.click(within(report).getByRole("button", { name: "发送诊断包" }))
    await waitFor(() =>
      expect(api.sendDiagnosticReport).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      ),
    )
    expect(await within(report).findByText(/已提交给软件维护者/)).toBeInTheDocument()
  })

  it("opens the drawer and generates a paginated preview on the first action", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    })
    const api = mockApi()
    installApi(api)
    renderApp()

    expect(screen.queryByRole("img", { name: "排版预览第 1 页" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    expect(
      await screen.findByRole("dialog", { name: "预览&导出" }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(api.generatePreview).toHaveBeenCalledWith({
        requestId: expect.any(String),
        documentId: "document-fixture",
      }),
    )
    const firstPage = await screen.findByRole("img", {
      name: "排版预览第 1 页",
    })
    expect(firstPage).toBeInTheDocument()
    expect(screen.queryByLabelText("预览自动检查")).not.toBeInTheDocument()
    expect(screen.queryByText("PDF 文件结构")).not.toBeInTheDocument()
    expect(screen.queryByText("中文字形")).not.toBeInTheDocument()
    expect(screen.queryByText("生成时自动完成")).not.toBeInTheDocument()
    expect(firstPage.closest('[data-slot="card"]')).toBeNull()
    const firstPageSurface = firstPage.closest<HTMLElement>(
      '[data-slot="preview-page"]',
    )
    expect(firstPageSurface).toBeInTheDocument()
    expect(firstPageSurface).toHaveStyle({
      width: "100%",
      aspectRatio: "210 / 297",
    })
    expect(screen.queryByLabelText("预览缩放")).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ 页 · 开题报告/)).not.toBeInTheDocument()
    expect(screen.queryByText("当前有效")).not.toBeInTheDocument()
    expect(screen.queryByText(/^模板 /)).not.toBeInTheDocument()
    expect(screen.queryByText("第 1 页")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument()
    const previewDrawer = firstPage.closest<HTMLElement>(
      '[data-slot="sheet-content"]',
    )
    const acceptanceBoundary = await screen.findByText("Word 版式检查")
    expect(acceptanceBoundary.closest("[data-sonner-toast]")).not.toBeNull()
    expect(previewDrawer).not.toContainElement(acceptanceBoundary)
    expect(
      screen.getByText(
        "预览与 Word 文件的排版可能存在差异，提交前请使用 Word 或 WPS 检查。",
      ),
    ).toBeInTheDocument()
    expect(previewDrawer).toHaveClass(
      "data-[side=right]:w-full",
      "data-[side=right]:sm:max-w-none",
    )
    expect(previewDrawer).toHaveStyle({ width: "512px", maxWidth: "800px" })
    const resizeHandle = screen.getByRole("separator", {
      name: "调整预览抽屉宽度",
    })
    expect(resizeHandle).toHaveAttribute("data-slot", "resizable-handle")
    expect(resizeHandle).toHaveAttribute("aria-orientation", "vertical")
    expect(resizeHandle).toHaveAttribute("tabindex", "0")
    // Pointer and keyboard geometry need layout; the background browser smoke test covers them.
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    const drawerHeader = previewDrawer?.querySelector<HTMLElement>(
      '[data-slot="sheet-header"]',
    )
    expect(drawerHeader).not.toBeNull()
    expect(within(drawerHeader!).getByRole("button", { name: "导出" })).toBeInTheDocument()

    closePreviewDrawerFromBackdrop()
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "预览&导出" }),
      ).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    expect(await screen.findByRole("img", {
      name: "排版预览第 1 页",
    })).toBeInTheDocument()
    expect(api.generatePreview).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText("Word 版式检查")).toHaveLength(1)
  })

  it("marks the generated preview stale as soon as input changes", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    closePreviewDrawerFromBackdrop()
    replaceRichText(
      screen.getByRole("textbox", { name: "本选题的意义及国内外发展状况" }),
      "预览后修改的选题意义\n更新后的国内外发展状况",
    )

    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.generatePreview).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("button", { name: "导出" })).toBeEnabled()
  })

  it("never marks a preview for an older edit revision as current", async () => {
    const api = mockApi()
    let resolvePreview!: (value: typeof previewResult) => void
    const pendingPreview = new Promise<typeof previewResult>((resolve) => {
      resolvePreview = resolve
    })
    vi.mocked(api.generatePreview).mockReturnValue(pendingPreview)
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.generatePreview).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole("img", { name: "正在生成分页预览" }),
    ).toBeInTheDocument()
    replaceRichText(
      screen.getByLabelText("本选题的意义及国内外发展状况"),
      "预览生成期间修改的选题意义",
    )
    await act(async () => {
      resolvePreview(previewResult)
      await pendingPreview
    })

    expect(await screen.findByText("预览已过期")).toBeInTheDocument()
    expect(screen.queryByText("当前有效")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
  })

  it("blocks export until the active template workspace is available", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue({
      ...environmentResult,
      checks: environmentResult.checks.map((check) =>
        check.id === "proposal_engine"
          ? {
              ...check,
              status: "warn" as const,
              message: "开题报告模板工程不可用，请重新关联。",
            }
          : check,
      ),
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    expect(await screen.findByText("暂时无法生成预览")).toBeInTheDocument()
    const exportButton = screen.getByRole("button", { name: "导出" })
    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAttribute(
      "title",
      "请先在左侧“导出记录”中选择可用模板",
    )
    expect(api.generatePreview).not.toHaveBeenCalled()
  })

  it.each([
    [null, "合成学生甲-开题报告"],
    [{ ...completeProfileDraft, full_name: "合成学生乙" }, "合成学生乙-开题报告"],
    [{ ...completeProfileDraft, full_name: "" }, "开题报告"],
  ])("uses the current profile name for the automatically created proposal (%s)", async (profileDraft, title) => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: profileDraft, document: null, documents: [] })
    installApi(api)
    renderApp()
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith(expect.objectContaining({ document_type: "proposal", title })))
  })

  it("prefills a new filename from the current edited student name", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息", exact: true }))
    fireEvent.change(screen.getByLabelText("学生姓名", { exact: true }), { target: { value: "合成学生丙" } })
    fireEvent.click(screen.getByRole("button", { name: "新建开题报告" }))
    expect(screen.getByLabelText("文件名")).toHaveValue("合成学生丙-开题报告")
    expect(api.renameDocument).not.toHaveBeenCalled()
  })

  it("creates a proposal using its document label when no student name exists", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile: null,
      profile_draft: null,
      document: null,
      documents: [],
    })
    installApi(api)

    renderApp()

    await waitFor(() => expect(api.createDocument).toHaveBeenCalledTimes(1))
    expect(api.createDocument).toHaveBeenCalledWith({
      profile_id: null,
      document_type: "proposal",
      template_version: "0.1.0-dev.1",
      schema_version: "0.2",
      title: "开题报告",
    })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sections: expect.objectContaining({
            research_content: ["本课题研究内容如下："],
            methods_and_means: ["本课题研究方法、手段如下："],
            research_steps: ["本课题研究步骤如下："],
          }),
        }),
      }),
    ), { timeout: 5000 })
    expect(await screen.findByLabelText("保存状态：已保存")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /研究内容未完成/ }))
    const researchEditor = screen.getByRole("textbox", { name: "研究内容" })
    expect(researchEditor).toHaveTextContent("本课题研究内容如下：")
    expect(researchEditor.querySelectorAll("p")).toHaveLength(2)
    await waitFor(() => expect(researchEditor).toHaveFocus())
    fireEvent.paste(researchEditor, {
      clipboardData: {
        types: ["text/plain"],
        getData: (type: string) => type === "text/plain" ? "研究合成样本。" : "",
      },
    })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sections: expect.objectContaining({
            research_content: ["本课题研究内容如下：", "研究合成样本。"],
          }),
        }),
      }),
    ), { timeout: 5000 })
    expect(screen.queryByRole("textbox", { name: "引导句（可删改）" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /研究方法未完成/ }))
    const methodsEditor = screen.getByRole("textbox", { name: "研究方法与手段" })
    expect(methodsEditor).toHaveTextContent("本课题研究方法、手段如下：")
    expect(methodsEditor.querySelectorAll("p")).toHaveLength(2)
    await waitFor(() => expect(methodsEditor).toHaveFocus())
    fireEvent.paste(methodsEditor, {
      clipboardData: {
        types: ["text/plain"],
        getData: (type: string) => type === "text/plain" ? "采用访谈与对比分析。" : "",
      },
    })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sections: expect.objectContaining({
            methods_and_means: ["本课题研究方法、手段如下：", "采用访谈与对比分析。"],
          }),
        }),
      }),
    ), { timeout: 5000 })
    const savedContent = vi.mocked(api.saveDraft).mock.calls.at(-1)?.[0].content as { sections: Record<string, unknown> }
    expect(savedContent.sections).not.toHaveProperty("methods_and_means_intro")
    expect(screen.getByRole("button", { name: /研究方法已填写/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /研究步骤未完成/ }))
    const stepsEditor = screen.getByRole("textbox", { name: "研究步骤" })
    expect(stepsEditor.querySelectorAll("p")).toHaveLength(2)
    await waitFor(() => expect(stepsEditor).toHaveFocus())
  })

  it("moves an older separate proposal intro into the body when saving", async () => {
    const api = mockApi()
    const legacyContent = {
      ...draftContent,
      sections: {
        ...draftContent.sections,
        methods_and_means_intro: "旧版自定义引导句：",
      },
    }
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: documentFixture({ content: legacyContent }),
      documents: [documentFixture({ content: legacyContent })],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /研究方法已填写/ }))
    const methodsEditor = screen.getByRole("textbox", { name: "研究方法与手段" })
    expect(methodsEditor.querySelector("p")?.textContent).toMatch(/^旧版自定义引导句：/)
    expect(methodsEditor).toHaveTextContent("合成研究方法")
    fireEvent.click(screen.getByRole("button", { name: /研究内容已填写/ }))
    replaceRichText(screen.getByRole("textbox", { name: "研究内容" }), "更新研究内容。")
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalled(), { timeout: 5000 })
    const savedContent = vi.mocked(api.saveDraft).mock.calls.at(-1)?.[0].content as { sections: Record<string, unknown> }
    expect(savedContent.sections.methods_and_means).toEqual([
      "旧版自定义引导句：",
      "合成研究方法",
    ])
    expect(savedContent.sections).not.toHaveProperty("methods_and_means_intro")
  })

  it("autosaves the shared thesis title through the student profile", async () => {
    const api = mockApi()
    let resolveProfile!: (value: StudentProfile) => void
    const pendingProfile = new Promise<StudentProfile>((resolve) => {
      resolveProfile = resolve
    })
    vi.mocked(api.saveProfile).mockReturnValue(pendingProfile)
    installApi(api)
    renderApp()

    const title = await openSharedThesisTitle()
    vi.useFakeTimers()
    replaceRichText(title, "更新后的合成题目")
    expect(screen.getByLabelText("保存状态：未保存")).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(699))
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(api.saveProfileDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("保存状态：正在保存")).toBeInTheDocument()
    const savedProfileDraft = vi.mocked(api.saveProfileDraft).mock.calls[0][0]
    const savedProfile = vi.mocked(api.saveProfile).mock.calls[0][0]
    expect(JSON.stringify(savedProfileDraft.thesis_title)).toContain(
      "更新后的合成题目",
    )
    expect(JSON.stringify(savedProfile.thesis_title)).toContain(
      "更新后的合成题目",
    )
    expect(api.saveDraft).not.toHaveBeenCalled()

    await act(async () => {
      resolveProfile({
        ...profile,
        thesis_title: savedProfile.thesis_title ?? [],
      })
      await pendingProfile
    })
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
  })

  it("autosaves document changes without rewriting the completed profile", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    const significance = await screen.findByLabelText(
      "本选题的意义及国内外发展状况",
    )
    vi.useFakeTimers()
    replaceRichText(significance, "只需要保存正文的选题意义")
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
  })

  it("skips autosave IPC when an edit returns to the persisted value", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const advisorTitle = screen.getByLabelText("指导教师职称")
    vi.useFakeTimers()
    fireEvent.change(advisorTitle, { target: { value: "教授" } })
    fireEvent.change(advisorTitle, { target: { value: "副教授" } })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
  })

  it("retries only the still-dirty document after a mixed save partially succeeds", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValueOnce(
      new Error("DOCUMENT_DRAFT_SAVE_FAILED"),
    )
    installApi(api)
    renderApp()

    const significance = await screen.findByLabelText(
      "本选题的意义及国内外发展状况",
    )
    replaceRichText(significance, "等待重试的正文")
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "教授" },
    })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })

    expect(api.saveProfileDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("保存状态：保存失败")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "合成开题报告" }))
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    await waitFor(() =>
      expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument(),
    )
    expect(api.saveProfileDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfile).toHaveBeenCalledTimes(1)
    expect(api.saveDraft).toHaveBeenCalledTimes(2)
  })

  it("does not check or preview an older revision when editing continues during save", async () => {
    const api = mockApi()
    let resolveSave!: (value: SaveDraftResult) => void
    const pendingSave = new Promise<SaveDraftResult>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(api.saveDraft).mockReturnValue(pendingSave)
    installApi(api)
    renderApp()

    const significance = await screen.findByLabelText(
      "本选题的意义及国内外发展状况",
    )
    replaceRichText(significance, "等待保存的选题意义")
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    closePreviewDrawer()

    replaceRichText(significance, "保存等待期间继续编辑的选题意义")
    await act(async () => {
      resolveSave({
        document_id: "document-fixture",
        revision: 3,
        save_reason: "manual",
        saved_at: "2026-08-30T00:00:01Z",
      })
      await pendingSave
    })

    expect(
      await screen.findByText(
        "保存期间内容发生了变化，请等待当前内容保存后重新检查。",
      ),
    ).toBeInTheDocument()
    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(api.generatePreview).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：未保存")).toBeInTheDocument()
  })

  it("autosaves BibTeX source separately from generated references", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /参考文献/ }))
    const source = `@article{demo2026,
  author={张三 and 李四},
  title={合成参考文献},
  journal={深圳技术大学学报},
  year={2026},
  volume={2},
  number={1},
  pages={1--8}
}`
    fireEvent.click(screen.getByRole("button", { name: "继续添加" }))
    fireEvent.change(
      screen.getByRole("textbox", { name: "参考文献 BibTeX" }),
      { target: { value: source } },
    )
    fireEvent.click(screen.getByRole("button", { name: "添加 1 条参考文献" }))

    expect(
      screen.getByText(
        "[1] 张三，李四． 合成参考文献[J]．深圳技术大学学报，2026，2（1）：1-8．",
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    const savedContent = vi.mocked(api.saveDraft).mock.calls[0][0].content
    expect(savedContent).toMatchObject({
      editor_state: {
        bibliography: {
          source_format: "bibtex",
          source_text: source,
          parse_status: "valid",
          entry_count: 1,
        },
      },
      sections: {
        references: [
          {
            type: "paragraph",
            runs: [
              {
                text: "[1] 张三，李四． 合成参考文献[J]．深圳技术大学学报，2026，2（1）：1-8．",
              },
            ],
          },
        ],
      },
    })
  })

  it("rejects invalid BibTeX edits and clears generated references through deletion", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /参考文献/ }))
    const validSource =
      "@article{valid, author={张三}, title={可用条目}, journal={合成期刊}, year={2026}}"
    fireEvent.click(screen.getByRole("button", { name: "继续添加" }))
    fireEvent.change(
      screen.getByRole("textbox", { name: "参考文献 BibTeX" }),
      { target: { value: validSource } },
    )
    fireEvent.click(screen.getByRole("button", { name: "添加 1 条参考文献" }))

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })
    vi.mocked(api.saveDraft).mockClear()

    const invalidSource = "@article{broken, title={缺少作者和期刊}}"
    fireEvent.click(screen.getByRole("button", { name: /\[1\].*可用条目/ }))
    fireEvent.click(screen.getByRole("button", { name: "编辑 valid" }))
    fireEvent.change(
      screen.getByRole("textbox", { name: "单条参考文献 BibTeX" }),
      { target: { value: invalidSource } },
    )
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(api.saveDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "删除 valid" }))
    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })
    const clearedContent = vi.mocked(api.saveDraft).mock.calls[0][0].content
    expect(clearedContent).not.toHaveProperty("editor_state")
    expect((clearedContent.sections as JsonObject).references).toEqual([])
  })

  it("autosaves a partial profile from empty fields and restores it after remount", async () => {
    const api = mockApi()
    let persistedProfileDraft = { ...emptyProfileDraft }
    const partialDocument = documentFixture({ profile_id: null })
    vi.mocked(api.openWorkspace).mockImplementation(async () => ({
      mode: "persistent" as const,
      profile: null,
      profile_draft: persistedProfileDraft,
      document: partialDocument,
      documents: [partialDocument],
    }))
    vi.mocked(api.saveProfileDraft).mockImplementation(async (nextProfileDraft) => {
      persistedProfileDraft = { ...nextProfileDraft }
      return persistedProfileDraft
    })
    installApi(api)

    const firstRender = renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学生姓名"), {
      target: { value: "只填写了姓名" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...emptyProfileDraft,
      full_name: "只填写了姓名",
    }, null)
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()

    vi.useRealTimers()
    firstRender.unmount()
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    expect(screen.getByLabelText("学生姓名")).toHaveValue("只填写了姓名")
    expect(screen.getByLabelText("学号")).toHaveValue("")
  })

  it("restores an explicitly cleared profile field instead of the old complete profile", async () => {
    const api = mockApi()
    let persistedProfileDraft: StudentProfileDraft | null = null
    const activeDocument = documentFixture()
    vi.mocked(api.openWorkspace).mockImplementation(async () => ({
      mode: "persistent" as const,
      profile,
      profile_draft: persistedProfileDraft,
      document: activeDocument,
      documents: [activeDocument],
    }))
    vi.mocked(api.saveProfileDraft).mockImplementation(async (nextProfileDraft) => {
      persistedProfileDraft = { ...nextProfileDraft }
      return persistedProfileDraft
    })
    installApi(api)

    const firstRender = renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...completeProfileDraft,
      advisor_title: "",
    }, profile.id)
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()

    vi.useRealTimers()
    firstRender.unmount()
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    const restoredAdvisorTitle = screen.getByLabelText("指导教师职称")
    expect(restoredAdvisorTitle).toHaveValue("")
    expect(screen.queryByText("请输入指导教师职称。")).not.toBeInTheDocument()
    fireEvent.focus(restoredAdvisorTitle)
    fireEvent.blur(restoredAdvisorTitle)
    expect(screen.getByText("请输入指导教师职称。")).toBeInTheDocument()
  })

  it("saves profile-only changes without touching a conflicting document revision", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValue(
      Object.assign(new Error("stale revision"), { code: "REVISION_CONFLICT" }),
    )
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "档案与基本信息" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "教授" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...completeProfileDraft,
      advisor_title: "教授",
    }, profile.id)
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ advisor_title: "教授" }),
    )
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
    expect(screen.queryByText("版本冲突")).not.toBeInTheDocument()
  })

  it("does not claim a save when profile draft persistence fails", async () => {
    const api = mockApi()
    vi.mocked(api.saveProfileDraft).mockRejectedValue(
      new Error("PROFILE_DRAFT_SAVE_FAILED"),
    )
    installApi(api)
    renderApp()

    const title = await openSharedThesisTitle()
    vi.useFakeTimers()
    replaceRichText(title, "草稿保存会失败")
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(screen.getByLabelText("保存状态：保存失败")).toBeInTheDocument()
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("blocks content checking while the shared profile is incomplete", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: { ...completeProfileDraft, advisor_title: "" },
      document: documentFixture(),
      documents: [documentFixture()],
    })
    installApi(api)
    renderApp()

    await screen.findByLabelText("保存状态：已保存")
    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))

    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        "请先打开左侧“档案与基本信息”，补全姓名、学号、毕业届别、学院、专业、班级、指导教师和职称。",
      ),
    ).toBeInTheDocument()
  })

  it("shows revision conflict without claiming the draft was saved", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValue(
      Object.assign(new Error("stale revision"), { code: "REVISION_CONFLICT" }),
    )
    installApi(api)
    renderApp()

    const significance = await screen.findByLabelText(
      "本选题的意义及国内外发展状况",
    )
    vi.useFakeTimers()
    replaceRichText(significance, "会发生冲突的选题意义")
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(screen.getAllByText("版本冲突")).not.toHaveLength(0)
    expect(screen.queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "预览&导出" })).toBeDisabled()
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(api.generatePreview).not.toHaveBeenCalled()
  })

  it("preflights the saved proposal and exports Word plus PDF", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    const exportButton = await screen.findByRole("button", { name: "导出" })
    fireEvent.click(exportButton)
    expect(await screen.findByRole("menu")).toHaveClass("w-56")
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "同时导出 Word 和 PDF",
      }),
    )

    await waitFor(() =>
      expect(api.checkDocument).toHaveBeenCalledWith("document-fixture"),
    )
    expect(api.chooseExportDirectory).toHaveBeenCalledTimes(1)
    expect(api.preflightExport).toHaveBeenCalledWith({
      documentId: "document-fixture",
      previewId: "preview-fixture",
      outputDirectory: "/tmp/sztu-export-test",
      formats: ["docx", "pdf"],
    })
    expect(api.exportDocument).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "document-fixture",
      previewId: "preview-fixture",
      outputDirectory: "/tmp/sztu-export-test",
      formats: ["docx", "pdf"],
      overwriteConfirmed: false,
      preflightToken: "e".repeat(64),
    })
    await waitFor(() =>
      expect(api.recordDocumentCompletion).toHaveBeenCalledWith({
        documentId: "document-fixture",
        documentType: "proposal",
      }),
    )
    expect(celebrateExportSuccess).toHaveBeenCalledTimes(1)
    closePreviewDrawer()
    await openOperationsPanel()
    expect(screen.queryByText("/tmp/sztu-export-test/proposal.pdf")).not.toBeInTheDocument()
  })

  it.each(["preflight", "export"] as const)("marks classified PREVIEW_STALE from %s stale and regenerates on reopen", async stage => {
    const api = mockApi()
    const error = Object.assign(new Error("模板在预览后发生变化，请重新生成预览。"), { code: "PREVIEW_STALE" })
    if (stage === "preflight") vi.mocked(api.preflightExport).mockRejectedValueOnce(error)
    else vi.mocked(api.exportDocument).mockRejectedValueOnce(error)
    installApi(api)
    renderApp()
    await generateCurrentPreview(api)
    fireEvent.click(screen.getByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 PDF" }))
    expect(await screen.findByText("预览已过期")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "重新生成预览" })).toBeEnabled()
    closePreviewDrawerFromBackdrop()
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.generatePreview).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("button", { name: "导出" })).toBeEnabled()
    expect(screen.queryByText("预览已过期")).not.toBeInTheDocument()
  })

  it("keeps a current preview reusable after an unrelated classified export failure", async () => {
    const api = mockApi()
    vi.mocked(api.preflightExport).mockRejectedValueOnce(Object.assign(new Error("导出目录不可写。"), { code: "OUTPUT_NOT_WRITABLE" }))
    installApi(api)
    renderApp()
    await generateCurrentPreview(api)
    fireEvent.click(screen.getByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 PDF" }))
    await waitFor(() => expect(api.recordTelemetry).toHaveBeenCalledWith(expect.objectContaining({ action: "export", outcome: "failure", errorCode: "OUTPUT_NOT_WRITABLE" })))
    expect(screen.queryByText("预览已过期")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
    closePreviewDrawerFromBackdrop()
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    expect(await screen.findByRole("img", { name: "排版预览第 1 页" })).toBeInTheDocument()
    expect(api.generatePreview).toHaveBeenCalledTimes(1)
  })

  it("does not continue exporting when content changes during the export check", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()
    await generateCurrentPreview(api)

    let resolveCheck!: (value: { checks: [typeof contentCheck] }) => void
    const pendingCheck = new Promise<{ checks: [typeof contentCheck] }>(
      (resolve) => {
        resolveCheck = resolve
      },
    )
    vi.mocked(api.checkDocument).mockReturnValueOnce(pendingCheck)

    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "同时导出 Word 和 PDF",
      }),
    )
    await waitFor(() => expect(api.checkDocument).toHaveBeenCalledTimes(2))

    replaceRichText(
      screen.getByLabelText("本选题的意义及国内外发展状况"),
      "导出检查期间修改的选题意义",
    )
    await act(async () => {
      resolveCheck({ checks: [contentCheck] })
      await pendingCheck
    })

    expect(
      await screen.findByText("检查期间内容发生了变化，本次检查结果已丢弃。"),
    ).toBeInTheDocument()
    expect(api.chooseExportDirectory).not.toHaveBeenCalled()
    expect(api.preflightExport).not.toHaveBeenCalled()
    expect(api.exportDocument).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
  })

  it("offers a preflighted LaTeX source bundle export", async () => {
    const api = mockApi()
    vi.mocked(api.exportDocument).mockResolvedValue({
      ...exportReceipt,
      artifacts: [
        {
          format: "tex",
          path: "/tmp/sztu-export-test/开题报告-LaTeX.zip",
          sha256: "f".repeat(64),
          size_bytes: 3456,
        },
      ],
    })
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "导出 LaTeX 源码包" }),
    )

    await waitFor(() =>
      expect(api.preflightExport).toHaveBeenCalledWith({
        documentId: "document-fixture",
        previewId: "preview-fixture",
        outputDirectory: "/tmp/sztu-export-test",
        formats: ["tex"],
      }),
    )
    expect(api.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ formats: ["tex"], overwriteConfirmed: false }),
    )
    closePreviewDrawer()
    await openOperationsPanel()
    expect(
      screen.queryByText("/tmp/sztu-export-test/开题报告-LaTeX.zip"),
    ).not.toBeInTheDocument()
  })

  it("exports an automatically versioned target without an overwrite dialog", async () => {
    const api = mockApi()
    vi.mocked(api.preflightExport).mockResolvedValue({
      ...preflightResult,
      targets: [
        {
          format: "docx",
          filename: "未命名开题报告-开题报告-2.docx",
          path: "/tmp/sztu-export-test/未命名开题报告-开题报告-2.docx",
          exists: false,
        },
      ],
      overwrite_required: false,
    })
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))

    await waitFor(() => expect(api.exportDocument).toHaveBeenCalledTimes(1))
    expect(api.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ overwriteConfirmed: false }),
    )
    expect(screen.queryByText("目标文件已存在")).not.toBeInTheDocument()
  })

  it("can request cancellation for an in-progress export", async () => {
    const api = mockApi()
    let rejectExport!: (reason: unknown) => void
    vi.mocked(api.exportDocument).mockReturnValue(
      new Promise((_, reject) => {
        rejectExport = reject
      }),
    )
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))
    closePreviewDrawer()
    await openOperationsPanel()
    const cancelButton = await screen.findByRole("button", { name: "取消导出" })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(api.cancelExport).toHaveBeenCalledTimes(1))
    expect(api.cancelExport).toHaveBeenCalledWith(expect.any(String))
    expect(cancelButton).toBeDisabled()
    expect(celebrateExportSuccess).not.toHaveBeenCalled()

    await act(async () => {
      rejectExport(Object.assign(new Error("cancelled"), { code: "EXPORT_CANCELLED" }))
    })
    expect(
      (await screen.findAllByText("已取消导出。"))
        .length,
    ).toBeGreaterThan(0)
    expect(celebrateExportSuccess).not.toHaveBeenCalled()
  })

  it("renders compact history actions and reveals artifacts without manual QA controls", async () => {
    const api = mockApi()
    vi.mocked(api.listExportHistory).mockResolvedValue({
      schema_version: "1.0",
      history: [historyJob],
    })
    installApi(api)
    renderApp()

    await openOperationsPanel()
    expect(await screen.findByText("开题报告.docx")).toBeInTheDocument()
    expect(screen.queryByText(/文件结构通过/)).not.toBeInTheDocument()
    expect(screen.queryByText(/中文字形通过/)).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "产物" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument()
    expect(screen.getByLabelText("导出状态：可用")).toHaveClass(
      "bg-emerald-50",
      "text-emerald-700",
    )
    expect(api.recordQa).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /管理导出记录/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "打开本地位置" }))
    await waitFor(() =>
      expect(api.revealExportArtifact).toHaveBeenCalledWith("artifact-docx-fixture"),
    )
    fireEvent.click(screen.getByRole("button", { name: /管理导出记录/ }))
    expect(
      screen.queryByRole("menuitem", { name: "记录人工验收" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("记录 Word/WPS 人工验收")).not.toBeInTheDocument()
  })

  it("marks missing artifacts and deletes only their history record", async () => {
    const api = mockApi()
    vi.mocked(api.listExportHistory).mockResolvedValue({
      schema_version: "1.0",
      history: [
        {
          ...historyJob,
          artifacts: historyJob.artifacts.map((artifact) => ({
            ...artifact,
            file_state: "missing" as const,
          })),
        },
      ],
    })
    installApi(api)
    renderApp()

    await openOperationsPanel()
    expect(await screen.findByText("已删除或移动")).toBeInTheDocument()
    const historyCallsBeforeFocus = vi.mocked(api.listExportHistory).mock.calls.length
    window.dispatchEvent(new Event("focus"))
    await waitFor(() =>
      expect(api.listExportHistory).toHaveBeenCalledTimes(historyCallsBeforeFocus + 1),
    )

    fireEvent.click(screen.getByRole("button", { name: /管理导出记录/ }))
    expect(await screen.findByRole("menuitem", { name: "打开本地位置" })).toHaveAttribute(
      "data-disabled",
    )
    fireEvent.click(screen.getByRole("menuitem", { name: "删除记录" }))
    expect(await screen.findByText("删除这条导出记录？")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }))

    await waitFor(() =>
      expect(api.deleteExportHistory).toHaveBeenCalledWith({
        documentId: "document-fixture",
        exportId: "export-fixture",
      }),
    )
    expect(await screen.findByText("当前文档还没有导出记录。")).toBeInTheDocument()
  })

  it("navigates a failed check to the matching editor field", async () => {
    const api = mockApi()
    const failedMethodsCheck = {
      ...contentCheck,
      check_id: "proposal-methods-required",
      status: "fail" as const,
      message: "请补充研究方法与手段。",
      code: "DOCUMENT_NOT_READY",
      details: { field: "sections.methods_and_means[0]" },
    }
    vi.mocked(api.checkDocument).mockResolvedValue({
      checks: [failedMethodsCheck],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.checkDocument).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "研究方法与手段" }),
      ).toHaveFocus(),
    )
    expect(screen.queryByRole("dialog", { name: "预览&导出" })).not.toBeInTheDocument()
    // Repeat from the same section: pane/section changes alone cannot drive focus.
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    await waitFor(() => expect(api.checkDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "研究方法与手段" })).toHaveFocus())
  })

  it("links a local template workspace and refreshes environment checks", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue(
      environmentWithUnavailableTemplate("proposal_engine"),
    )
    installApi(api)
    renderApp()

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "重新关联模板" }))
    await waitFor(() => expect(api.installTemplatePack).toHaveBeenCalledTimes(1))
    expect(api.installTemplatePack).toHaveBeenCalledWith("proposal")
    await waitFor(() => expect(api.checkEnvironment).toHaveBeenCalledTimes(2))
  })

  it("exposes the existing image tool only in proposal body sections", async () => {
    renderApp()

    await screen.findByRole("heading", { name: "开题报告" })
    fireEvent.click(screen.getByRole("button", { name: /选题意义/ }))
    expect(screen.queryByRole("button", { name: "插入图片" })).toBeNull()

    for (const sectionName of [/研究内容/, /研究方法/, /研究步骤/]) {
      fireEvent.click(screen.getByRole("button", { name: sectionName }))
      expect(screen.getByRole("button", { name: "插入图片" })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole("button", { name: /参考文献/ }))
    expect(screen.queryByRole("button", { name: "插入图片" })).toBeNull()
  })

  it("switches to the submitted task-book template without repeating shared profile fields", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue(
      environmentWithUnavailableTemplate("task_book_engine"),
    )
    const proposal = documentFixture()
    const taskBook = taskBookDocumentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: proposal,
      documents: [proposal, taskBook],
    })
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: taskBook,
      documents: [proposal, taskBook],
    })
    installApi(api)
    const { container } = renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "任务书" }))
    fireEvent.click(await screen.findByRole("button", { name: "合成任务书" }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("task-book-document"),
    )

    expect(
      await screen.findByRole("heading", { name: "任务书" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "所需资料可留空" }),
    ).toBeEnabled()
    expect(screen.queryByRole("textbox", { name: "中文题目" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /内容要求/ }))
    expect(
      screen.getByRole("textbox", { name: "内容要求" }),
    ).toHaveTextContent(
      "完成统一数据模型和双路文档渲染。",
    )
    expect(screen.getByRole("button", { name: "插入图片" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /进度安排/ }))
    expect(screen.queryByRole("button", { name: "插入图片" })).toBeNull()
    expect(screen.getByLabelText("第 1 项时间范围")).toHaveValue("2026年11月1日—11月15日")
    expect(screen.getByRole("textbox", { name: "第 1 项进度内容" })).toHaveTextContent(
      "完成文献调研和需求分析。",
    )
    fireEvent.click(
      screen.getByRole("button", { name: "编辑第 2 项进度内容" }),
    )
    expect(screen.getByLabelText("第 2 项时间范围")).toHaveValue("2026年11月16日—12月15日")
    fireEvent.click(screen.getByRole("button", { name: /所需资料/ }))
    expect(screen.getByRole("button", { name: "插入图片" })).toBeInTheDocument()
    expect(
      screen.getByRole("toolbar", {
        name: "需收集的资料及主要参考文献资料格式工具栏",
      }).parentElement,
    ).not.toHaveClass("rounded-lg", "border")
    fireEvent.click(screen.getByRole("button", { name: /选题信息/ }))
    expect(screen.queryByRole("button", { name: "插入图片" })).toBeNull()
    expect(
      container.querySelector('[data-slot="task-topic-surface"]'),
    ).toHaveClass("h-full", "items-center", "justify-center")
    expect(
      container.querySelector('[data-slot="task-topic-form"]'),
    ).toHaveClass("grid", "max-w-xl")
    expect(
      container.querySelector('[data-slot="task-topic-form"]'),
    ).not.toHaveClass("md:grid-cols-2")
    expect(screen.getByLabelText("选题性质")).toHaveTextContent("毕业设计")
    expect(screen.getByLabelText("课题来源")).toHaveTextContent("科研项目")
    expect(screen.getByLabelText("科研项目级别")).toHaveTextContent("省部级")
    expect(screen.getByLabelText("项目编号")).toHaveValue("SYN-PROJECT-001")
    expect(screen.queryByLabelText("学生姓名")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学号")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学院")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("指导教师职称")).not.toBeInTheDocument()
    expect(screen.queryByText("任务书填写边界")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /进度安排/ }))
    fireEvent.click(screen.getByRole("button", { name: "新增进度" }))
    fireEvent.change(screen.getByLabelText("第 3 项时间范围"), {
      target: { value: "2026年12月16日—12月31日" },
    })
    replaceRichText(
      screen.getByRole("textbox", { name: "第 3 项进度内容" }),
      "完成结构化编辑器验收。",
    )
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "task-book-document",
        content: expect.objectContaining({
          metadata: expect.objectContaining({
            graduation_year: 2026,
            student_name: "合成学生甲",
            student_id: "SYN-0001",
            class_name: "示例一班",
            advisor: "合成教师乙",
          }),
          sections: expect.objectContaining({
            basic_content_and_requirements: [
              "完成统一数据模型和双路文档渲染。",
            ],
            schedule: [
              expect.objectContaining({ period: "2026年11月1日—11月15日" }),
              expect.objectContaining({ period: "2026年11月16日—12月15日" }),
              expect.objectContaining({
                period: "2026年12月16日—12月31日",
                content: "完成结构化编辑器验收。",
              }),
            ],
            topic_information: {
              nature: "graduation_design",
              source: {
                type: "research_project",
                research_project: {
                  level: "provincial_ministerial",
                  project_number: "SYN-PROJECT-001",
                },
              },
            },
          }),
        }),
      }),
    )
    const savedContent = vi.mocked(api.saveDraft).mock.calls[0][0].content
    expect(savedContent.metadata).not.toHaveProperty("advisor_title")

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "重新关联模板" }))
    await waitFor(() =>
      expect(api.installTemplatePack).toHaveBeenCalledWith("task_book"),
    )
  })

  it("keeps one shared thesis title after switching documents", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue(
      environmentWithUnavailableTemplate("midterm_engine"),
    )
    const proposal = documentFixture()
    const taskBook = taskBookDocumentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: proposal,
      documents: [proposal, taskBook],
    })
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: taskBook,
      documents: [proposal, taskBook],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "任务书" }))
    fireEvent.click(await screen.findByRole("button", { name: "合成任务书" }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("task-book-document"),
    )
    const sharedTitle = await openSharedThesisTitle()
    expect(sharedTitle).toHaveTextContent("合成开题报告")
    expect(sharedTitle).not.toHaveTextContent("合成任务书题目")
  })

  it("creates a task-book document with the submitted schema version", async () => {
    const api = mockApi()
    const proposal = documentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: proposal,
      documents: [proposal],
    })
    vi.mocked(api.createDocument).mockImplementation(async (input) =>
      taskBookDocumentFixture({
        id: "new-task-book",
        profile_id: input.profile_id ?? null,
        document_type: input.document_type,
        template_version: input.template_version,
        schema_version: input.schema_version,
        title: input.title,
        current_revision: 0,
        content: null,
        saved_at: null,
        save_reason: null,
      }),
    )
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: taskBookDocumentFixture({ id: "new-task-book", content: null }),
      documents: [
        proposal,
        taskBookDocumentFixture({ id: "new-task-book", content: null }),
      ],
      deleted_documents: [],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "新建任务书" }))
    fireEvent.click(await screen.findByRole("button", { name: "新建" }))
    await waitFor(() =>
      expect(api.createDocument).toHaveBeenCalledWith({
        profile_id: profile.id,
        document_type: "task_book",
        template_version: "0.2+66c968c",
        schema_version: "0.1",
        title: "合成学生甲-任务书",
        source_document_id: undefined,
      }),
    )
    expect(
      await screen.findByRole("heading", { name: "任务书" }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /选题信息/ }))
    expect(screen.getByLabelText("选题性质")).toHaveTextContent("毕业论文")
  })

  it("validates task-book schedule fields independently", async () => {
    const api = mockApi()
    const taskBook = taskBookDocumentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: taskBook,
      documents: [taskBook],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /进度安排/ }))
    fireEvent.change(screen.getByLabelText("第 1 项时间范围"), {
      target: { value: "" },
    })
    expect(screen.queryByText("缺少时间范围。")).not.toBeInTheDocument()
    fireEvent.blur(screen.getByLabelText("第 1 项时间范围"))
    expect(screen.getByText("缺少时间范围。")).toBeInTheDocument()
  })

  it("restores an incomplete structured schedule row without dropping it", async () => {
    const api = mockApi()
    const taskBook = taskBookDocumentFixture()
    const sections = taskBook.content?.sections as JsonObject
    const incomplete = {
      ...taskBook,
      content: {
        ...taskBook.content,
        sections: {
          ...sections,
          schedule: [
            ...(sections.schedule as JsonValue[]),
            { period: "", content: "" },
          ],
        },
      },
    }
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: incomplete,
      documents: [incomplete],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /进度安排/ }))
    fireEvent.click(
      screen.getByRole("button", { name: "编辑第 3 项进度内容" }),
    )
    expect(screen.getByLabelText("第 3 项时间范围")).toHaveValue("")
    expect(screen.queryByText("缺少时间范围。")).not.toBeInTheDocument()
    fireEvent.blur(screen.getByLabelText("第 3 项时间范围"))
    expect(screen.getByText("缺少时间范围。")).toBeInTheDocument()
  })

  it("checks, previews, and exports the active task-book document", async () => {
    const api = mockApi()
    const taskBook = taskBookDocumentFixture()
    const taskTemplate = {
      template_id: "sztu.task-book.2026.local",
      version: "0.1+46b6d97",
      pack_sha256: "7".repeat(64),
    }
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: taskBook,
      documents: [taskBook],
    })
    vi.mocked(api.generatePreview).mockResolvedValue({
      ...previewResult,
      document_id: taskBook.id,
      template: taskTemplate,
    })
    vi.mocked(api.preflightExport).mockImplementation(async (input) => ({
      ...preflightResult,
      document_id: taskBook.id,
      template: taskTemplate,
      targets: input.formats.map((format) => ({
        format,
        filename: `任务书.${format === "tex" ? "zip" : format}`,
        path: `/tmp/sztu-export-test/任务书.${format === "tex" ? "zip" : format}`,
        exists: false,
      })),
    }))
    vi.mocked(api.exportDocument).mockResolvedValue({
      ...exportReceipt,
      template: taskTemplate,
      artifacts: [
        {
          format: "docx",
          path: "/tmp/sztu-export-test/任务书.docx",
          sha256: "8".repeat(64),
          size_bytes: 4321,
        },
      ],
    })
    installApi(api)
    renderApp()

    await screen.findByRole("heading", { name: "任务书" })
    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    await waitFor(() =>
      expect(api.checkDocument).toHaveBeenCalledWith("task-book-document"),
    )
    await waitFor(() =>
      expect(api.generatePreview).toHaveBeenCalledWith({
        requestId: expect.any(String),
        documentId: "task-book-document",
      }),
    )
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))

    await waitFor(() =>
      expect(api.preflightExport).toHaveBeenCalledWith({
        documentId: "task-book-document",
        previewId: "preview-fixture",
        outputDirectory: "/tmp/sztu-export-test",
        formats: ["docx"],
      }),
    )
    expect(api.exportDocument).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "task-book-document",
      previewId: "preview-fixture",
      outputDirectory: "/tmp/sztu-export-test",
      formats: ["docx"],
      overwriteConfirmed: false,
      preflightToken: "e".repeat(64),
    })
  })

  it("blocks task-book checks when the shared cohort has no four-digit year", async () => {
    const api = mockApi()
    const taskBook = taskBookDocumentFixture()
    const profileWithoutYear = { ...profile, graduation_cohort: "春季2026批次" }
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile: profileWithoutYear,
      profile_draft: null,
      document: taskBook,
      documents: [taskBook],
    })
    installApi(api)
    renderApp()

    expect(await screen.findByText("毕业届别缺少年份")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "预览&导出" }))
    expect(
      await screen.findByText(/毕业届别须包含四位年份/),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("combobox", { name: "毕业届别" })).toHaveFocus())
    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(api.generatePreview).not.toHaveBeenCalled()
  })

  it("switches to an existing midterm document and exposes only student-owned fields", async () => {
    const api = mockApi()
    vi.mocked(api.getMidtermDatePolicyStatus).mockResolvedValue({
      state: "ready",
      rules: [{ college: "示例学院", startDate: "2026-03-26", endDate: "2026-03-30" }],
    })
    vi.mocked(api.checkEnvironment).mockResolvedValue(
      environmentWithUnavailableTemplate("midterm_engine"),
    )
    const proposal = documentFixture()
    const midterm = documentFixture({
      id: "midterm-document",
      document_type: "midterm",
      template_version: "0.1+local.20260830",
      schema_version: "0.1",
      title: "中期检查表",
      content: {
        metadata: {
          title: "虚构中期检查课题",
          student_name: "合成学生甲",
          college: "示例学院",
          major: "示例专业",
          class_name: "示例一班",
          advisor: "合成教师乙",
          check_date: "2026-03-25",
        },
        sections: {
          directory: [
            { level: 1, number: "1", title: "绪论" },
            { level: 2, number: "1.1", title: "研究背景" },
          ],
          main_research_content: [
            { type: "paragraph", runs: [{ text: "研究虚构问题。" }] },
          ],
          progress: [
            { type: "paragraph", runs: [{ text: "已完成合成验证。" }] },
          ],
        },
      },
    })
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: proposal,
      documents: [proposal, midterm],
    })
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: midterm,
      documents: [proposal, midterm],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "中期检查" }))
    fireEvent.click(await screen.findByRole("button", { name: "中期检查表" }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("midterm-document"),
    )
    expect(
      await screen.findByRole("heading", { name: "中期检查表" }),
    ).toBeInTheDocument()
    const checkDate = screen.getByLabelText("检查日期")
    const documentFooter = document.querySelector<HTMLElement>('[data-slot="save-status-footer"]')
    expect(documentFooter).not.toBeNull()
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sections: expect.objectContaining({
            editable_headings: true,
            main_research_content: ["主要研究内容：", { type: "paragraph", runs: [{ text: "研究虚构问题。" }] }],
            progress: ["毕业论文（设计）工作进展情况（详述）：", { type: "paragraph", runs: [{ text: "已完成合成验证。" }] }],
          }),
        }),
      }),
    ), { timeout: 5000 })
    await waitFor(() => expect(within(documentFooter!).getByLabelText("保存状态：已保存")).toBeInTheDocument())
    expect(checkDate.closest('[data-slot="card"]')).toHaveClass(
      "border-0",
      "shadow-none",
    )
    expect(checkDate).toHaveTextContent("2026年3月25日")
    expect(screen.getByText("请选择有效的检查日期。")).toBeInTheDocument()
    fireEvent.click(checkDate)
    expect(screen.getByRole("button", { name: /25/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /30/ }))
    expect(checkDate).toHaveTextContent("2026年3月30日")
    fireEvent.click(screen.getByRole("button", { name: /论文目录/ }))
    expect(screen.getAllByText("论文目录")).toHaveLength(1)
    expect(screen.getByLabelText("第 1 条目录编号")).toHaveTextContent("1")
    expect(
      screen.getByRole("button", { name: "第 1 条目录标题" }),
    ).toHaveTextContent("绪论")
    expect(screen.getByLabelText("第 2 条目录编号")).toHaveTextContent("1.1")
    expect(
      screen.getByRole("button", { name: "第 2 条目录标题" }),
    ).toHaveTextContent("研究背景")
    expect(screen.queryByLabelText("学生姓名")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学号")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学院")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("专业")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("班级")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("指导教师")).not.toBeInTheDocument()
    expect(screen.queryByText("中期检查填写边界")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    expect(await screen.findByRole("heading", { name: "基本信息" })).toBeInTheDocument()
    expect(screen.getByLabelText("学生姓名")).toHaveValue("合成学生甲")
    expect(screen.getByLabelText("学号")).toHaveValue("SYN-0001")
    expect(screen.getByLabelText("班级")).toHaveValue("示例一班")
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("副教授")
    expect(screen.getByLabelText("毕业届别")).toHaveValue("2026届")
    expect(screen.queryByText("预览&导出")).not.toBeInTheDocument()
    expect(screen.queryByText("档案与导出快照")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "检查内容" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "中期检查表" }))

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "重新关联模板" }))
    await waitFor(() =>
      expect(api.installTemplatePack).toHaveBeenCalledWith("midterm"),
    )
  })

  it("prefills both midterm headings as editable body paragraphs", async () => {
    const api = mockApi()
    const midterm = documentFixture({
      id: "new-midterm",
      document_type: "midterm",
      template_version: "0.3+66c968c",
      schema_version: "0.1",
      title: "未命名中期检查表",
      content: null,
      current_revision: 0,
    })
    vi.mocked(api.createDocument).mockResolvedValue(midterm)
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: midterm,
      documents: [documentFixture(), midterm],
      deleted_documents: [],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "新建中期检查" }))
    fireEvent.click(await screen.findByRole("button", { name: "新建" }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sections: expect.objectContaining({
            editable_headings: true,
            main_research_content: ["主要研究内容："],
            progress: ["毕业论文（设计）工作进展情况（详述）："],
          }),
        }),
      }),
    ), { timeout: 5000 })
    fireEvent.click(screen.getByRole("button", { name: /研究内容未完成/ }))
    const researchEditor = screen.getByRole("textbox", { name: "研究内容" })
    expect(researchEditor.querySelectorAll("p")).toHaveLength(2)
    expect(researchEditor).toHaveTextContent("主要研究内容：")
    fireEvent.click(screen.getByRole("button", { name: /进展情况未完成/ }))
    const progressEditor = screen.getByRole("textbox", { name: "毕业论文（设计）进展情况" })
    expect(progressEditor.querySelectorAll("p")).toHaveLength(2)
    expect(progressEditor).toHaveTextContent("毕业论文（设计）工作进展情况（详述）：")
  })

  it("opens an existing image block in the structured midterm editor", async () => {
    const api = mockApi()
    const midterm = documentFixture({
      id: "midterm-with-image",
      document_type: "midterm",
      template_version: "0.1+local.20260830",
      schema_version: "0.1",
      title: "含图片的中期检查表",
      content: {
        metadata: {
          title: "含图片的合成课题",
          student_name: profile.full_name,
          college: profile.college,
          major: profile.major,
          class_name: profile.class_name,
          advisor: profile.advisor_name,
          check_date: "2026-03-26",
        },
        sections: {
          directory: [{ level: 1, number: "1", title: "绪论" }],
          main_research_content: [
            {
              type: "image",
              path: "images/synthetic.png",
              alt: "合成示意图",
            },
          ],
          progress: [
            { type: "paragraph", runs: [{ text: "已完成合成验证。" }] },
          ],
        },
      },
    })
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: midterm,
      documents: [midterm],
    })
    installApi(api)
    renderApp()

    await screen.findByRole("heading", { name: "中期检查表" })
    fireEvent.click(screen.getByRole("button", { name: /研究内容/ }))

    expect(await screen.findByText("图片：合成示意图")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "研究内容" })).toBeInTheDocument()
    expect(
      screen.queryByText("当前内容暂不支持编辑"),
    ).not.toBeInTheDocument()
  })

  it("opens persisted tables and figure groups in the structured midterm editor", async () => {
    const api = mockApi()
    const midterm = documentFixture({
      id: "midterm-with-image",
      document_type: "midterm",
      template_version: "0.1+local.20260830",
      schema_version: "0.1",
      title: "含图片的中期检查表",
      content: {
        metadata: {
          title: "含图片的合成课题",
          student_name: profile.full_name,
          college: profile.college,
          major: profile.major,
          class_name: profile.class_name,
          advisor: profile.advisor_name,
          check_date: "2026-03-26",
        },
        sections: {
          directory: [{ level: 1, number: "1", title: "绪论" }],
          main_research_content: [
            {
              type: "data_table", style: "three_line", columns: [{ header: "项目" }, { header: "结果" }], rows: [{ cells: ["样本", "10"] }], caption: "测试表",
            },
            {
              type: "figure_group", id: "fig-midterm_0001", chapter: 1, columns: 2,
              caption: "测试组合图", items: [{ path: "image/a.png", alt: "子图 A" }, { path: "image/b.png", alt: "子图 B" }],
            },
          ],
          progress: [
            { type: "paragraph", runs: [{ text: "已完成合成验证。" }] },
          ],
        },
      },
    })
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: midterm,
      documents: [midterm],
    })
    installApi(api)
    renderApp()

    await screen.findByRole("heading", { name: "中期检查表" })
    fireEvent.click(screen.getByRole("button", { name: /研究内容/ }))

    expect(await screen.findByText("测试表")).toBeInTheDocument()
    expect(screen.getByText("图 1-1 测试组合图")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "插入图表" })).toBeEnabled()
    expect(screen.getByRole("textbox", { name: "研究内容" })).toBeInTheDocument()
    expect(
      screen.queryByText("当前内容暂不支持编辑"),
    ).not.toBeInTheDocument()
  })

  it("does not expose a temporary workspace in the one-pass document flow", async () => {
    renderApp()

    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
    expect(screen.queryByRole("button", { name: "临时模式" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "返回持久工作区" }),
    ).not.toBeInTheDocument()
  })
})

describe("environment boundary", () => {
  afterEach(() => {
    cleanup()
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })

  it("shows an actionable error when the sidecar request fails", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockRejectedValue(new Error("SIDECAR_EXITED"))
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    expect(await screen.findByText("暂时无法生成预览")).toBeInTheDocument()
    closePreviewDrawer()
    await openOperationsPanel()
    expect(screen.getByText("文档服务未连接")).toBeInTheDocument()
    expect(screen.getByText("SIDECAR_EXITED")).toBeInTheDocument()
  })
})

describe("single-page assessment forms", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })
  it.each([
    ["advisor_review", "指导教师评审表"],
    ["reviewer_review", "评阅人评审表"],
    ["defense_record", "答辩记录表"],
    ["grade_assessment", "成绩考核表"],
  ] as const)("previews %s with independent editable guidance and exports PDF through the shared format menu", async (type, label) => {
    const api = mockApi()
    const assessment = documentFixture({ document_type: type, title: `合成${label}`, schema_version: "0.1", content: null })
    const printProfile = { ...profile, advisor_name: null, advisor_title: null, class_name: null, graduation_cohort: null }
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: printProfile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, checks: [...environmentResult.checks, { id: `${type}_engine`, required: false, status: "pass", message: "评审模板可用。" }] })
    installApi(api)
    renderApp()
    expect(await screen.findByRole("heading", { name: label })).toBeInTheDocument()
    expect(screen.queryByText("基本信息尚未补全")).not.toBeInTheDocument()
    if (type === "advisor_review") {
      fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
      expect(screen.getByLabelText("学生姓名")).toBeInTheDocument()
      expect(screen.queryByText("请输入班级。")).not.toBeInTheDocument()
      expect(screen.queryByText("请输入指导教师姓名。")).not.toBeInTheDocument()
      expect(screen.queryByText("请输入指导教师职称。")).not.toBeInTheDocument()
      const group = screen.getByRole("button", { name: label })
      if (group.getAttribute("aria-expanded") !== "true") fireEvent.click(group)
      fireEvent.click(screen.getByRole("button", { name: `合成${label}` }))
    }
    await generateCurrentPreview(api)
    expect(api.checkDocument).toHaveBeenCalled()
    const saved = vi.mocked(api.saveDraft).mock.calls.at(-1)?.[0].content as JsonObject
    expect(saved.metadata).toMatchObject({ student_name: profile.full_name, student_id: profile.student_number, advisor: "", advisor_title: "", reviewer: "" })
    expect(saved.sections).toEqual({ editable_headings: true, writing_guidance: { comments: type === "defense_record" ? null : assessmentWritingGuidance[type], division_of_work: type === "advisor_review" ? assessmentWritingGuidance.divisionOfWork : null, questions: type === "defense_record" ? assessmentWritingGuidance.defense_record : null }, comments: [], division_of_work: [], suggested_grade: "", questions: [], members: [], final_grade: "", date: "" })
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(screen.getAllByRole("button", { name: "导出" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "其他导出格式" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导出 PDF" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "导出" }))
    expect(await screen.findByRole("menuitem", { name: "导出 Word" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "导出 LaTeX 源码包" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "同时导出 Word 和 PDF" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 PDF" }))
    await waitFor(() => expect(api.preflightExport).toHaveBeenCalledWith(expect.objectContaining({ formats: ["pdf"] })))
    await waitFor(() => expect(api.exportDocument).toHaveBeenCalledWith(expect.objectContaining({ formats: ["pdf"] })))
  })

  it.each(["advisor_review", "reviewer_review", "grade_assessment"] as const)("navigates independent %s fields and saves a date selected with the existing calendar", async type => {
    const api = mockApi()
    const assessment = documentFixture({ document_type: type, schema_version: "0.1", content: assessmentContent({ ...emptyAssessmentDraft(), date: "2026-03-25", comments: ["已保存的意见"], divisionOfWork: ["已保存的分工"] }, { title: "合成论文", student_name: profile.full_name, student_id: profile.student_number, college: profile.college, major: profile.major, advisor: "", advisor_title: "" }) })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, checks: [...environmentResult.checks, { id: `${type}_engine`, required: false, status: "pass", message: "评审模板可用。" }] })
    installApi(api)
    renderApp()
    const sectionNav = within(await screen.findByRole("navigation", { name: "当前文档板块" }))
    if (type === "advisor_review") {
      fireEvent.click(sectionNav.getByRole("button", { name: "分工情况" }))
      const division = screen.getByRole("textbox", { name: "合作课题分工情况" })
      expect(division).toHaveTextContent("已保存的分工")
      expect(division.closest('[data-slot="immersive-writing-surface"]')).not.toBeNull()
      expect(division.closest('[data-slot="card"]')).toBeNull()
      expect(screen.queryByRole("textbox", { name: "评审意见" })).not.toBeInTheDocument()
    } else expect(sectionNav.queryByRole("button", { name: "分工情况" })).not.toBeInTheDocument()
    fireEvent.click(sectionNav.getByRole("button", { name: type === "grade_assessment" ? "小组意见" : "评审意见" }))
    const comments = screen.getByRole("textbox", { name: type === "grade_assessment" ? "答辩小组意见" : "评审意见" })
    expect(comments).toHaveTextContent("已保存的意见")
    const writingSurface = comments.closest('[data-slot="immersive-writing-surface"]')
    expect(writingSurface).not.toBeNull()
    expect(comments.closest('[data-slot="card"]')).toBeNull()
    expect(within(writingSurface as HTMLElement).getByRole("button", { name: "预览&导出" })).toBeInTheDocument()
    replaceRichText(comments, "修改后的意见")
    expect(comments).toHaveTextContent("修改后的意见")
    expect(screen.queryByLabelText("建议成绩")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("日期")).not.toBeInTheDocument()
    fireEvent.click(sectionNav.getByRole("button", { name: type === "grade_assessment" ? "最终成绩" : "建议成绩" }))
    expect(screen.queryByRole("textbox", { name: "评审意见" })).not.toBeInTheDocument()
    const date = screen.getByLabelText("日期")
    expect(date.tagName).toBe("BUTTON")
    expect(date).toHaveTextContent("2026年3月25日")
    fireEvent.click(date)
    fireEvent.click(await screen.findByRole("button", { name: /30/ }))
    expect(date).toHaveTextContent("2026年3月30日")
    await generateCurrentPreview(api)
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ date: "2026-03-30", comments: [expect.stringContaining("修改后的意见")], division_of_work: ["已保存的分工"] }) }) }))
  })

  it.each([
    ["advisor_review", "评审意见", "评审意见"],
    ["advisor_review", "分工情况", "合作课题分工情况"],
    ["reviewer_review", "评审意见", "评审意见"],
    ["grade_assessment", "小组意见", "答辩小组意见"],
    ["defense_record", "问答记录", "答辩记录正文"],
  ] as const)("edits and deletes %s guidance independently of body in the shared editor", async (type, section, editorName) => {
    const api = mockApi()
    const assessment = documentFixture({ document_type: type, schema_version: "0.1", content: null })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, checks: [...environmentResult.checks, { id: `${type}_engine`, required: false, status: "pass", message: "评审模板可用。" }] })
    installApi(api)
    renderApp()
    const nav = within(await screen.findByRole("navigation", { name: "当前文档板块" }))
    fireEvent.click(nav.getByRole("button", { name: section }))
    const editor = screen.getByRole("textbox", { name: editorName })
    const starter = section === "分工情况" ? assessmentWritingGuidance.divisionOfWork : assessmentWritingGuidance[type]
    expect(editor).toHaveTextContent(starter)
    const paragraphs = editor.querySelectorAll("p")
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1].querySelector("br")).not.toBeNull()
    expect(editor).toHaveFocus()
    expect(window.getSelection()?.anchorNode).toBe(paragraphs[1])
    const bodyField = section === "分工情况" ? "division_of_work" : "comments"
    const guideField = type === "defense_record" ? "questions" : bodyField
    fireEvent.paste(editor, { clipboardData: { types: ["text/plain"], getData: (format: string) => format === "text/plain" ? "保留正文" : "" } })
    const instance = (editor as HTMLElement & { editor: Editor }).editor
    act(() => {
      instance.commands.setTextSelection({ from: 1, to: starter.length + 1 })
      instance.commands.insertContent("自定义写作提示")
    })
    expect(editor).toHaveTextContent("自定义写作提示")
    expect(editor).toHaveTextContent("保留正文")
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ writing_guidance: expect.objectContaining({ [guideField]: "自定义写作提示" }), [bodyField]: ["保留正文"] }) }) })), { timeout: 5000 })
    act(() => {
      instance.commands.setTextSelection({ from: 1, to: "自定义写作提示".length + 1 })
      instance.commands.deleteSelection()
    })
    fireEvent.click(nav.getByRole("button", { name: "基本信息" }))
    fireEvent.click(nav.getByRole("button", { name: section }))
    const reopened = screen.getByRole("textbox", { name: editorName })
    expect(reopened).not.toHaveTextContent(starter)
    expect(reopened).not.toHaveTextContent("自定义写作提示")
    expect(reopened).toHaveTextContent("保留正文")
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ writing_guidance: expect.objectContaining({ [guideField]: null }), [bodyField]: ["保留正文"] }) }) })), { timeout: 5000 })
    replaceRichText(reopened, "")
    fireEvent.click(nav.getByRole("button", { name: "基本信息" }))
    fireEvent.click(nav.getByRole("button", { name: section }))
    const emptied = screen.getByRole("textbox", { name: editorName })
    expect(emptied.querySelectorAll("p")).toHaveLength(1)
    expect(emptied).not.toHaveTextContent(starter)
    fireEvent.focus(emptied)
    fireEvent.paste(emptied, { clipboardData: { types: ["text/plain"], getData: (format: string) => format === "text/plain" ? "删除后重写的正文" : "" } })
    await generateCurrentPreview(api)
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ editable_headings: true, writing_guidance: expect.objectContaining({ [guideField]: null }), [bodyField]: ["删除后重写的正文"] }) }) }))
  })

  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"] as const)("persists the v1 to v2 %s guidance migration even when the saved draft was clean", async type => {
    const api = mockApi()
    const content = assessmentContent({ ...emptyAssessmentDraft(), editableHeadings: true, comments: [assessmentStarterParagraphs[type], "旧草稿正文"] }, {})
    const sections = content.sections as JsonObject
    delete sections.writing_guidance
    const assessment = documentFixture({ document_type: type, schema_version: "0.1", content })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    installApi(api)
    renderApp()
    await screen.findByRole("heading", { name: type === "advisor_review" ? "指导教师评审表" : type === "reviewer_review" ? "评阅人评审表" : type === "defense_record" ? "答辩记录表" : "成绩考核表" })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ comments: ["旧草稿正文"], writing_guidance: expect.objectContaining({ [type === "defense_record" ? "questions" : "comments"]: assessmentWritingGuidance[type] }) }) }) })), { timeout: 5000 })
    expect(sections.comments).toEqual([assessmentStarterParagraphs[type], "旧草稿正文"])
  })

  it("promotes a previously saved basic profile draft before checking an assessment form", async () => {
    const api = mockApi()
    const assessment = documentFixture({ document_type: "advisor_review", profile_id: null, title: "合成导师评审", schema_version: "0.1", content: null })
    const basicDraft = { ...completeProfileDraft, class_name: "", advisor_name: "", advisor_title: "", graduation_cohort: "" }
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: null, profile_draft: basicDraft, document: assessment, documents: [assessment], deleted_documents: [] })
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, checks: [...environmentResult.checks, { id: "advisor_review_engine", required: false, status: "pass", message: "导师评审模板可用。" }] })
    vi.mocked(api.checkDocument).mockImplementation(async () => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ full_name: profile.full_name, student_number: profile.student_number, college: profile.college, major: profile.major, class_name: "", advisor_name: "", advisor_title: "" }))
      return { checks: [contentCheck] }
    })
    installApi(api)
    renderApp()
    expect(await screen.findByRole("heading", { name: "指导教师评审表" })).toBeInTheDocument()
    await generateCurrentPreview(api)
    expect(api.saveProfile).toHaveBeenCalledTimes(1)
    expect(api.saveProfileDraft).toHaveBeenCalledTimes(1)
    expect(api.generatePreview).toHaveBeenCalled()
  })

  it("keeps defense editor placeholders in the saved draft and can still reach the printing pipeline", async () => {
    const api = mockApi()
    const assessment = documentFixture({ document_type: "defense_record", title: "合成答辩记录", schema_version: "0.1", content: null })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, checks: [...environmentResult.checks, { id: "defense_record_engine", required: false, status: "pass", message: "答辩记录模板可用。" }] })
    installApi(api)
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: /问答记录/ }))
    fireEvent.click(screen.getByRole("button", { name: "添加问答" }))
    fireEvent.click(screen.getByRole("button", { name: /答辩人员/ }))
    fireEvent.click(screen.getByRole("button", { name: "添加答辩成员" }))
    await generateCurrentPreview(api)
    const saved = vi.mocked(api.saveDraft).mock.calls.at(-1)?.[0].content as JsonObject
    expect(saved.sections).toMatchObject({ members: [""], questions: [{ question: [], answer: [] }] })
    expect(api.checkDocument).toHaveBeenCalled()
    expect(api.generatePreview).toHaveBeenCalled()
  })
})

describe("workspace lifecycle", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(complete => { resolve = complete })
    return { promise, resolve }
  }

  const saved = (revision: number): SaveDraftResult => ({
    document_id: "document-fixture", revision, save_reason: "manual", saved_at: "2026-10-03T00:00:00Z",
  })
  const conflict = () => Object.assign(new Error("synthetic conflict"), { code: "REVISION_CONFLICT" })
  const requestClose = (api: SztuDesktopApi, id = "synthetic-close") => vi.mocked(api.onCloseRequest).mock.calls[0][0](id)
  const forceEditorCallback = (body: HTMLElement, text: string) => (body as HTMLElement & { editor: Editor }).editor.commands.insertContent(text)
  const workspaceSnapshot = () => {
    const first = documentFixture({ title: "虚构文档 A" })
    const second = documentFixture({ id: "document-b", title: "虚构文档 B" })
    const third = documentFixture({ id: "document-c", title: "虚构文档 C" })
    return { mode: "persistent" as const, profile, profile_draft: null, document: first, documents: [first, second, third], deleted_documents: [] as DocumentRecord[] }
  }
  async function mountBody(api: SztuDesktopApi) {
    installApi(api)
    const mounted = renderApp()
    const body = await screen.findByLabelText("本选题的意义及国内外发展状况")
    await screen.findByLabelText("保存状态：已保存")
    return { body, mounted }
  }

  it("adds an empty student workspace and waits for its scoped draft before switching back", async () => {
    const api = mockApi()
    const original = workspaceSnapshot()
    const second = {
      ...profile, id: "profile-second", full_name: "合成学生乙", student_number: "SYN-0002",
      class_name: null, advisor_name: null, advisor_title: null, graduation_cohort: null,
      thesis_title: null, thesis_title_en: null,
    }
    const profiles = [profile, second]
    const saving = deferred<StudentProfileDraft>()
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...original, profiles: [profile] })
    vi.mocked(api.createProfile).mockResolvedValue({
      ...original, profiles, profile: second, document: null,
    })
    vi.mocked(api.saveProfileDraft).mockReturnValue(saving.promise)
    vi.mocked(api.saveProfile).mockResolvedValue({ ...second, full_name: "乙改名" })
    vi.mocked(api.selectProfile).mockResolvedValue({ ...original, profiles })
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    fireEvent.click(screen.getByRole("button", { name: "新建档案" }))
    const dialog = await screen.findByRole("dialog", { name: "新建档案" })
    for (const [label, value] of [["姓名", second.full_name], ["学号", second.student_number], ["学院", second.college], ["专业", second.major]]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "新建" }))
    await waitFor(() => expect(screen.getByLabelText("学生姓名")).toHaveValue("合成学生乙"))
    expect(screen.getByRole("button", { name: "虚构文档 A" })).toBeInTheDocument()
    expect(api.createDocument).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("学生姓名"), { target: { value: "乙改名" } })
    fireEvent.click(screen.getByRole("button", { name: "选择要编辑的档案" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /合成学生甲/ }))
    await waitFor(() => expect(api.saveProfileDraft).toHaveBeenCalledWith(expect.objectContaining({ full_name: "乙改名" }), second.id))
    expect(api.selectProfile).not.toHaveBeenCalled()
    await act(async () => { saving.resolve({ ...emptyProfileDraft, full_name: "乙改名" }); await saving.promise })
    await waitFor(() => expect(screen.getByLabelText("学生姓名")).toHaveValue(profile.full_name))
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }))
    expect(api.selectProfile).toHaveBeenCalledWith(profile.id)
    expect(screen.getByRole("button", { name: "虚构文档 A" })).toBeInTheDocument()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("confirms deletion of the last student and restores the original documents from the deleted list", async () => {
    const api = mockApi()
    const original = { ...workspaceSnapshot(), profiles: [profile], deleted_profiles: [] }
    vi.mocked(api.openWorkspace).mockResolvedValue(original)
    vi.mocked(api.deleteProfile).mockResolvedValue({
      ...original, profile: null, profiles: [], deleted_profiles: [profile], document: null, documents: [],
    })
    vi.mocked(api.restoreProfile).mockResolvedValue(original)
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    fireEvent.click(screen.getByRole("button", { name: "管理档案" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除当前档案" }))
    let dialog = await screen.findByRole("dialog", { name: "删除当前档案？" })
    expect(within(dialog).getByText(/合成学生甲 · SYN-0001/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(api.deleteProfile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "管理档案" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除当前档案" }))
    dialog = await screen.findByRole("dialog", { name: "删除当前档案？" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除", exact: true }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "删除当前档案？" })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "管理档案" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "已删除档案" }))
    expect(api.deleteProfile).toHaveBeenCalledExactlyOnceWith(profile.id)
    expect(screen.queryByRole("button", { name: "虚构文档 A" })).not.toBeInTheDocument()
    expect(api.createDocument).not.toHaveBeenCalled()
    const deleted = await screen.findByRole("dialog", { name: "已删除档案" })
    fireEvent.click(within(deleted).getByRole("button", { name: /恢复 合成学生甲/ }))
    await waitFor(() => expect(screen.getByLabelText("学生姓名")).toHaveValue(profile.full_name))
    expect(api.restoreProfile).toHaveBeenCalledExactlyOnceWith(profile.id)
    expect(screen.getByRole("button", { name: "虚构文档 A" })).toBeInTheDocument()
  })

  it("keeps the selected student when its latest profile edit cannot be saved before deletion", async () => {
    const api = mockApi()
    vi.mocked(api.saveProfileDraft).mockRejectedValue(new Error("合成保存失败"))
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    fireEvent.change(screen.getByLabelText("学生姓名"), { target: { value: "保留待保存的姓名" } })
    fireEvent.click(screen.getByRole("button", { name: "管理档案" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除当前档案" }))
    const dialog = await screen.findByRole("dialog", { name: "删除当前档案？" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除", exact: true }))
    await waitFor(() => expect(screen.getByText("当前档案或草稿尚未保存，请保存后重试。")).toBeInTheDocument())
    expect(api.deleteProfile).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(screen.getByLabelText("学生姓名")).toHaveValue("保留待保存的姓名")
  })

  it("creates a task book for another profile from the shared document list", async () => {
    const api = mockApi()
    const original = workspaceSnapshot()
    const another = { ...profile, id: "profile-other", full_name: "合成学生乙", student_number: "SYN-0002" }
    const profiles = [profile, another]
    const task = taskBookDocumentFixture({ profile_id: another.id, title: "合成学生乙-任务书" })
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...original, profiles })
    vi.mocked(api.createDocument).mockResolvedValue(task)
    vi.mocked(api.selectDocument).mockResolvedValue({ ...original, profile: another, profiles, document: task, documents: [...original.documents, task] })
    const { body } = await mountBody(api)
    const saving = deferred<SaveDraftResult>()
    vi.mocked(api.saveDraft).mockReturnValue(saving.promise)
    replaceRichText(body, "离开前保存甲的正文")
    fireEvent.click(screen.getByRole("button", { name: "新建任务书" }))
    const dialog = await screen.findByRole("dialog", { name: "新建任务书" })
    expect(within(dialog).getByRole("combobox", { name: "使用档案" })).toHaveTextContent("合成学生甲")
    fireEvent.click(within(dialog).getByRole("combobox", { name: "使用档案" }))
    fireEvent.click(await screen.findByRole("option", { name: "合成学生乙 · SYN-0002" }))
    expect(within(dialog).getByLabelText("文件名")).toHaveValue("合成学生乙-任务书")
    fireEvent.click(within(dialog).getByRole("button", { name: "新建" }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ documentId: original.document.id })))
    expect(api.createDocument).not.toHaveBeenCalled()
    await act(async () => { saving.resolve(saved(3)); await saving.promise })
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith(expect.objectContaining({
      profile_id: another.id, document_type: "task_book", title: "合成学生乙-任务书",
    })))
    expect(api.selectProfile).not.toHaveBeenCalled()
    expect(api.selectDocument).toHaveBeenCalledWith(task.id)
    expect(await screen.findByRole("button", { name: "合成学生乙-任务书" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "虚构文档 A" })).toBeInTheDocument()
  })

  it("locks edits and reentrant selection through save and selection IPC", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    const saving = deferred<SaveDraftResult>()
    const selecting = deferred<typeof snapshot>()
    vi.mocked(api.openWorkspace).mockResolvedValue(snapshot)
    vi.mocked(api.saveDraft).mockReturnValue(saving.promise)
    vi.mocked(api.selectDocument).mockReturnValue(selecting.promise)
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "切换前已输入的正文")
    const selectB = screen.getByRole("button", { name: "虚构文档 B" })
    const selectC = screen.getByRole("button", { name: "虚构文档 C" })
    await act(async () => {
      fireEvent.click(selectB)
      fireEvent.click(selectC)
      forceEditorCallback(body, "同一事件循环中的延迟回调")
    })
    expect(body).toHaveAttribute("contenteditable", "false")
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ sections: expect.objectContaining({ significance_and_status: ["切换前已输入的正文"] }) }) }))
    expect(api.selectDocument).not.toHaveBeenCalled()
    await act(async () => { saving.resolve(saved(3)); await saving.promise })
    expect(api.selectDocument).toHaveBeenCalledTimes(1)
    expect(api.selectDocument).toHaveBeenCalledWith("document-b")
    expect(selectC).toBeDisabled()
    await act(async () => {
      forceEditorCallback(body, "IPC 等待期间的延迟回调")
      selecting.resolve({ ...snapshot, document: snapshot.documents[1] })
      await selecting.promise
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("本选题的意义及国内外发展状况")).toHaveAttribute("contenteditable", "true")
  })

  it.each(["create", "rename", "delete", "restore"] as const)("locks callbacks while the %s workspace transaction is pending", async operation => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    snapshot.deleted_documents = [documentFixture({ id: "deleted-fixture", title: "虚构回收文档", soft_deleted_at: "2026-10-01T00:00:00Z" })]
    const pending = deferred<void>()
    vi.mocked(api.openWorkspace).mockResolvedValue(snapshot)
    if (operation === "create") vi.mocked(api.createDocument).mockImplementation(async () => { await pending.promise; return snapshot.document })
    if (operation === "rename") vi.mocked(api.renameDocument).mockImplementation(async () => { await pending.promise; return snapshot })
    if (operation === "delete") vi.mocked(api.deleteDocument).mockImplementation(async () => { await pending.promise; return snapshot })
    if (operation === "restore") vi.mocked(api.restoreDocument).mockImplementation(async () => { await pending.promise; return snapshot })
    const { body } = await mountBody(api)
    if (operation === "create") {
      fireEvent.click(screen.getByRole("button", { name: "新建开题报告" }))
      fireEvent.click(within(await screen.findByRole("dialog", { name: "新建开题报告" })).getByRole("button", { name: "新建" }))
    } else if (operation === "restore") {
      fireEvent.click(screen.getByRole("button", { name: "回收站（1 个文档）" }))
      fireEvent.click(screen.getByRole("button", { name: "管理回收站文档 虚构回收文档" }))
      fireEvent.click(await screen.findByRole("menuitem", { name: "恢复" }))
    } else {
      fireEvent.click(screen.getByRole("button", { name: "管理文档 虚构文档 A" }))
      fireEvent.click(await screen.findByRole("menuitem", { name: operation === "rename" ? "重命名" : "移到回收站" }))
      const dialog = await screen.findByRole("dialog")
      fireEvent.click(within(dialog).getByRole("button", { name: operation === "rename" ? "保存" : "移到回收站" }))
    }
    await waitFor(() => expect(body).toHaveAttribute("contenteditable", "false"))
    act(() => { forceEditorCallback(body, "事务中不应生效的回调") })
    await act(async () => { pending.resolve(); await pending.promise })
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
  })

  it("keeps the current document and explains a failed selection", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue(workspaceSnapshot())
    vi.mocked(api.selectDocument).mockRejectedValue(new Error("虚构的读取失败"))
    const { body } = await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "虚构文档 B" }))
    expect(await screen.findByText("虚构的读取失败")).toBeInTheDocument()
    expect(body).toHaveAttribute("contenteditable", "true")
    expect(body).toHaveTextContent("第一段")
  })

  it("flushes before the document debounce and keeps editing locked until main closes", async () => {
    const api = mockApi()
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "关闭前最后输入的正文")
    expect(api.saveDraft).not.toHaveBeenCalled()
    await act(async () => { requestClose(api) })
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ reason: "manual", content: expect.objectContaining({ sections: expect.objectContaining({ significance_and_status: ["关闭前最后输入的正文"] }) }) }))
    expect(api.completeCloseRequest).toHaveBeenCalledWith({ requestId: "synthetic-close", outcome: "saved" })
    expect(body).toHaveAttribute("contenteditable", "false")
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
  })

  it("waits for the in-flight save and flushes the newer draft using its new revision", async () => {
    const api = mockApi()
    const pending = deferred<SaveDraftResult>()
    vi.mocked(api.saveDraft).mockReturnValueOnce(pending.promise).mockResolvedValue(saved(4))
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "第一份保存中的正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    replaceRichText(body, "保存过程中继续输入的第二份正文")
    await act(async () => { requestClose(api) })
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(api.completeCloseRequest).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(saved(3)); await pending.promise })
    expect(api.saveDraft).toHaveBeenCalledTimes(2)
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3, reason: "manual", content: expect.objectContaining({ sections: expect.objectContaining({ significance_and_status: ["保存过程中继续输入的第二份正文"] }) }) }))
    expect(api.completeCloseRequest).toHaveBeenCalledWith({ requestId: "synthetic-close", outcome: "saved" })
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
  })

  it("autosaves newer edits after an earlier save outlasts their debounce", async () => {
    const api = mockApi()
    const pending = deferred<SaveDraftResult>()
    vi.mocked(api.saveDraft).mockReturnValueOnce(pending.promise).mockResolvedValue(saved(4))
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "仍在保存的正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    replaceRichText(body, "继续编辑后停止输入的最新正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(saved(3)); await pending.promise })
    expect(api.saveDraft).toHaveBeenCalledTimes(2)
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3, content: expect.objectContaining({ sections: expect.objectContaining({ significance_and_status: ["继续编辑后停止输入的最新正文"] }) }) }))
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
  })

  it("reports failed close saving and keeps the current draft available for retry", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValueOnce(new Error("虚构保存失败"))
    vi.mocked(api.completeCloseRequest).mockResolvedValue({ accepted: false })
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "失败也必须保留的正文")
    await act(async () => { requestClose(api) })
    expect(api.completeCloseRequest).toHaveBeenCalledWith({ requestId: "synthetic-close", outcome: "failed", reason: "save_failed" })
    expect(body).toHaveAttribute("contenteditable", "true")
    expect(body).toHaveTextContent("失败也必须保留的正文")
    expect(screen.getByRole("button", { name: "重试保存" })).toBeEnabled()
  })

  it("unlocks when main no longer accepts a late close completion", async () => {
    const api = mockApi()
    vi.mocked(api.completeCloseRequest).mockResolvedValue({ accepted: false })
    const { body } = await mountBody(api)
    await act(async () => { requestClose(api) })
    expect(api.completeCloseRequest).toHaveBeenCalledWith({ requestId: "synthetic-close", outcome: "saved" })
    expect(body).toHaveAttribute("contenteditable", "true")
  })

  it("flushes a mounted layout-tool draft before its debounce when closing", async () => {
    const api = mockApi()
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "排版工具" }))
    fireEvent.click(screen.getByRole("button", { name: "三线表生成器" }))
    const caption = await screen.findByLabelText("表题（可选）")
    vi.useFakeTimers()
    fireEvent.change(caption, { target: { value: "关闭前的虚构表题" } })
    const key = "sztu-docs.thesis-tools.three-line-table.v1"
    expect(window.localStorage.getItem(key)).toBeNull()
    await act(async () => { requestClose(api) })
    expect(JSON.parse(window.localStorage.getItem(key) ?? "{}").value.caption).toBe("关闭前的虚构表题")
    expect(api.completeCloseRequest).toHaveBeenCalledWith({ requestId: "synthetic-close", outcome: "saved" })
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("preserves a conflicted draft across reload and remount, then clears it only after a successful restored save", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValueOnce(conflict())
    const { body, mounted } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "冲突后需要恢复的本地正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    const fresh = documentFixture({ current_revision: 9, content: { ...draftContent, sections: { ...draftContent.sections, significance_and_status: ["已经存入数据库的版本"] } } })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: null, document: fresh, documents: [fresh], deleted_documents: [] })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新载入" })) })
    expect(screen.getByLabelText("本选题的意义及国内外发展状况")).toHaveTextContent("已经存入数据库的版本")
    expect(readWorkspaceRecovery(fresh.id, "proposal")?.content.sections).toMatchObject({ significance_and_status: ["冲突后需要恢复的本地正文"] })
    mounted.unmount()
    vi.useRealTimers()
    renderApp()
    expect(await screen.findByRole("button", { name: "恢复保留草稿" })).toBeEnabled()
    vi.useFakeTimers()
    const restoring = deferred<SaveDraftResult>()
    vi.mocked(api.saveDraft).mockReturnValueOnce(restoring.promise)
    fireEvent.click(screen.getByRole("button", { name: "恢复保留草稿" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 9, content: expect.objectContaining({ sections: expect.objectContaining({ significance_and_status: ["冲突后需要恢复的本地正文"] }) }) }))
    expect(window.localStorage.getItem(workspaceRecoveryKey(fresh.id))).not.toBeNull()
    expect(api.saveProfileDraft).not.toHaveBeenCalled()
    await act(async () => { restoring.resolve(saved(10)); await restoring.promise })
    expect(window.localStorage.getItem(workspaceRecoveryKey(fresh.id))).toBeNull()
    expect(screen.queryByText("已保留重新载入前的草稿")).not.toBeInTheDocument()
  })

  it("does not reload or discard the conflict draft when recovery storage fails", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValue(conflict())
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "存储失败也必须保留的正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError") })
    const notify = vi.spyOn(toast, "error")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新载入" })) })
    expect(api.openWorkspace).toHaveBeenCalledTimes(1)
    expect(body).toHaveTextContent("存储失败也必须保留的正文")
    expect(body).toHaveAttribute("contenteditable", "true")
    expect(notify).toHaveBeenCalledWith("无法在本机保留当前草稿，已取消重新载入。请先复制需要保留的内容。")
  })

  it("allows explicitly keeping the reloaded version and removing its recovery copy", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValueOnce(conflict())
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "用户选择不恢复的内容")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新载入" })) })
    expect(window.localStorage.getItem(workspaceRecoveryKey("document-fixture"))).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "使用当前版本并移除副本" }))
    expect(window.localStorage.getItem(workspaceRecoveryKey("document-fixture"))).toBeNull()
    expect(screen.getByLabelText("本选题的意义及国内外发展状况")).toHaveTextContent("第一段")
    expect(screen.queryByRole("button", { name: "恢复保留草稿" })).not.toBeInTheDocument()
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
  })

  it("lets an initially failed workspace load be retried", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockRejectedValueOnce(new Error("SYNTHETIC_OPEN_FAILURE"))
    installApi(api)
    renderApp()
    const retry = await screen.findByRole("button", { name: "重新载入" })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await screen.findByLabelText("保存状态：已保存")
    expect(screen.queryByText("工作区载入失败")).not.toBeInTheDocument()
    expect(api.openWorkspace).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText("本选题的意义及国内外发展状况")).toHaveAttribute("contenteditable", "true")
  })

  it("keeps the recovery copy when conflict reload fails and can retry that reload", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValueOnce(conflict())
    const { body } = await mountBody(api)
    vi.useFakeTimers()
    replaceRichText(body, "重载失败后仍需保留的正文")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    vi.mocked(api.openWorkspace).mockRejectedValueOnce(new Error("SYNTHETIC_RELOAD_FAILURE"))
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新载入" })) })
    expect(screen.getByText("工作区载入失败")).toBeInTheDocument()
    const retained = window.localStorage.getItem(workspaceRecoveryKey("document-fixture"))
    expect(retained).toContain("重载失败后仍需保留的正文")
    const retry = screen.getByRole("button", { name: "重新载入" })
    expect(retry).toBeEnabled()
    await act(async () => { fireEvent.click(retry) })
    expect(screen.queryByText("工作区载入失败")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "恢复保留草稿" })).toBeEnabled()
    expect(window.localStorage.getItem(workspaceRecoveryKey("document-fixture"))).toBe(retained)
    expect(api.openWorkspace).toHaveBeenCalledTimes(3)
  })

  it("paginates document lists with the returned cursor and ignores duplicate records", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    const cursor = { updated_at: "2026-09-01T00:00:00Z", id: "cursor-1" }
    const nextCursor = { updated_at: "2026-08-01T00:00:00Z", id: "cursor-2" }
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...snapshot, documents_page: { profile_id: profile.id, next_cursor: cursor, has_more: true } })
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce({ profile_id: profile.id, deleted: false, documents: [snapshot.documents[0], documentFixture({ id: "page-2", title: "第二页文档" })], next_cursor: nextCursor, has_more: true })
      .mockResolvedValueOnce({ profile_id: profile.id, deleted: false, documents: [documentFixture({ id: "page-3", title: "最后一页文档" })], next_cursor: null, has_more: false })
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "加载更多文档" }))
    expect(await screen.findByRole("button", { name: "第二页文档" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "虚构文档 A" })).toHaveLength(1)
    expect(api.listDocuments).toHaveBeenNthCalledWith(1, { profileId: profile.id, deleted: false, cursor, limit: 100 })
    fireEvent.click(screen.getByRole("button", { name: "加载更多文档" }))
    expect(await screen.findByRole("button", { name: "最后一页文档" })).toBeInTheDocument()
    expect(api.listDocuments).toHaveBeenNthCalledWith(2, { profileId: profile.id, deleted: false, cursor: nextCursor, limit: 100 })
    expect(screen.queryByRole("button", { name: "加载更多文档" })).not.toBeInTheDocument()
  })

  it("loads the recycle bin independently from active documents", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    const cursor = { updated_at: "2026-09-01T00:00:00Z", id: "trash-cursor" }
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...snapshot, deleted_documents_page: { profile_id: profile.id, next_cursor: cursor, has_more: true } })
    vi.mocked(api.listDocuments).mockResolvedValue({ profile_id: profile.id, deleted: true, documents: [documentFixture({ id: "trash-2", title: "更早删除的文档", deleted_at: "2026-09-01T00:00:00Z" })], next_cursor: null, has_more: false })
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "回收站（已载入 0 个文档，还有更多）" }))
    fireEvent.click(screen.getByRole("button", { name: "加载更多回收站文档" }))
    expect(await screen.findByText("更早删除的文档")).toBeInTheDocument()
    expect(api.listDocuments).toHaveBeenCalledWith({ profileId: profile.id, deleted: true, cursor, limit: 100 })
    expect(screen.getByRole("button", { name: "回收站（1 个文档）" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "虚构文档 A" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "加载更多回收站文档" })).not.toBeInTheDocument()
  })

  it("ignores an old page response after changing the workspace and locks duplicate requests", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    const paging = deferred<Awaited<ReturnType<SztuDesktopApi["listDocuments"]>>>()
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...snapshot, documents_page: { profile_id: profile.id, next_cursor: { updated_at: "2026-09-01T00:00:00Z", id: "cursor" }, has_more: true } })
    vi.mocked(api.listDocuments).mockReturnValue(paging.promise)
    vi.mocked(api.selectDocument).mockResolvedValue({ ...snapshot, document: snapshot.documents[1] })
    await mountBody(api)
    const more = screen.getByRole("button", { name: "加载更多文档" })
    await act(async () => { fireEvent.click(more); fireEvent.click(more) })
    expect(api.listDocuments).toHaveBeenCalledTimes(1)
    expect(more).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "虚构文档 B" })) })
    await act(async () => { paging.resolve({ profile_id: profile.id, deleted: false, documents: [documentFixture({ id: "old-page", title: "过期分页记录" })], next_cursor: null, has_more: false }); await paging.promise })
    expect(screen.queryByRole("button", { name: "过期分页记录" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "加载更多文档" })).not.toBeInTheDocument()
  })

  it("keeps a failed page cursor available for retry", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    const cursor = { updated_at: "2026-09-01T00:00:00Z", id: "retry-page" }
    vi.mocked(api.openWorkspace).mockResolvedValue({ ...snapshot, documents_page: { profile_id: null, next_cursor: cursor, has_more: true } })
    vi.mocked(api.listDocuments).mockRejectedValueOnce(new Error("SYNTHETIC_PAGE_FAILURE"))
    const notify = vi.spyOn(toast, "error")
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "加载更多文档" }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith("SYNTHETIC_PAGE_FAILURE"))
    expect(screen.getByRole("button", { name: "加载更多文档" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "加载更多文档" }))
    await waitFor(() => expect(api.listDocuments).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.listDocuments).mock.calls[1][0].cursor).toEqual(cursor)
  })

  it("keeps the current filename out of the toolbar after selecting a document", async () => {
    const api = mockApi()
    const snapshot = workspaceSnapshot()
    vi.mocked(api.openWorkspace).mockResolvedValue(snapshot)
    vi.mocked(api.selectDocument).mockResolvedValue({ ...snapshot, document: snapshot.documents[1] })
    await mountBody(api)
    expect(screen.queryByLabelText("当前文件：虚构文档 A")).not.toBeInTheDocument()
    expect(within(screen.getByRole("toolbar", { name: /格式工具栏/ })).queryByText("虚构文档 A")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "虚构文档 B" }))
    await waitFor(() => expect(api.selectDocument).toHaveBeenCalled())
    expect(screen.queryByLabelText("当前文件：虚构文档 B")).not.toBeInTheDocument()
    expect(within(screen.getByRole("toolbar", { name: /格式工具栏/ })).queryByText("虚构文档 B")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("当前文件：虚构文档 A")).not.toBeInTheDocument()
  })

  it("reopens concrete environment repair instructions after postponing setup", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockResolvedValue({ ...environmentResult, ready: false, checks: [{ id: "xelatex", required: true, status: "fail", message: "缺少虚构测试 XeLaTeX" }] })
    await mountBody(api)
    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "查看环境修复指引" }))
    const guide = await screen.findByRole("dialog", { name: "环境检查" })
    expect(within(guide).getByText("缺少虚构测试 XeLaTeX")).toBeInTheDocument()
    fireEvent.click(within(guide).getByRole("button", { name: "打开 TeX 安装页面" }))
    expect(api.openToolLink).toHaveBeenCalledWith("mactex")
    fireEvent.click(within(guide).getByRole("button", { name: "返回工作台" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "环境检查" })).not.toBeInTheDocument())
  })

  it("can leave a reopened environment guide when the environment check fails", async () => {
    const api = mockApi()
    vi.mocked(api.checkEnvironment).mockRejectedValue(new Error("SYNTHETIC_ENGINE_FAILURE"))
    await mountBody(api)
    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "查看环境修复指引" }))
    const guide = await screen.findByRole("dialog", { name: "环境检查" })
    expect(within(guide).getByText("SYNTHETIC_ENGINE_FAILURE")).toBeInTheDocument()
    fireEvent.click(within(guide).getByRole("button", { name: "返回工作台" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "环境检查" })).not.toBeInTheDocument())
    expect(api.quitApp).not.toHaveBeenCalled()
  })

  it("shows profile errors after blur or a preview attempt instead of on first visit", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: null, profile_draft: emptyProfileDraft, document: documentFixture(), documents: [documentFixture()], deleted_documents: [] })
    await mountBody(api)
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    const studentName = await screen.findByLabelText("学生姓名")
    const studentId = screen.getByLabelText("学号")
    expect(studentName).toHaveAttribute("aria-invalid", "false")
    expect(studentId).toHaveAttribute("aria-invalid", "false")
    expect(screen.getByLabelText("中文题目")).toHaveAttribute("aria-invalid", "false")
    expect(screen.queryByText("请先补全基本信息")).not.toBeInTheDocument()
    fireEvent.focus(studentName)
    fireEvent.blur(studentName)
    expect(screen.getByText("请输入学生姓名。")).toBeInTheDocument()
    expect(studentId).toHaveAttribute("aria-invalid", "false")
    fireEvent.click(screen.getByRole("button", { name: "合成开题报告" }))
    fireEvent.click(await screen.findByRole("button", { name: "预览&导出" }))
    expect(await screen.findByText("请先补全基本信息")).toBeInTheDocument()
    expect(screen.getByLabelText("学号")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByLabelText("中文题目")).toHaveAttribute("aria-invalid", "true")
  })
})

describe("student-number academic autofill", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })

  async function mountProfile(api: SztuDesktopApi) {
    installApi(api)
    const mounted = renderApp()
    await screen.findByLabelText("保存状态：已保存")
    fireEvent.click(screen.getByRole("button", { name: "档案与基本信息" }))
    await screen.findByLabelText("学号")
    return mounted
  }

  it.each([
    ["202300202999", "2027届", "人工智能学院", "计算机科学与技术"],
    ["202200101999", "2026届", "中德智能制造学院", "机械设计制造及其自动化"],
  ])("fills and saves only the shared academic fields for synthetic number %s", async (studentNumber, cohort, college, major) => {
    const api = mockApi()
    await mountProfile(api)
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: studentNumber } })
    expect(screen.getByLabelText("毕业届别")).toHaveValue(cohort)
    expect(screen.getByLabelText("学院")).toHaveValue(college)
    expect(screen.getByLabelText("专业")).toHaveValue(major)
    expect(screen.getByLabelText("班级")).toHaveValue("")
    expect(screen.getByLabelText("学生姓名")).toHaveValue(profile.full_name)
    expect(screen.getByLabelText("指导教师")).toHaveValue(profile.advisor_name)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(api.saveProfileDraft).toHaveBeenCalledTimes(1)
    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...completeProfileDraft,
      student_number: studentNumber,
      graduation_cohort: cohort,
      college,
      major,
      class_name: "",
    }, profile.id)
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it("keeps existing academic fields for incomplete or unknown synthetic numbers", async () => {
    const api = mockApi()
    const activeDocument = documentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile, profile_draft: { ...completeProfileDraft, graduation_cohort: "2031届" }, document: activeDocument, documents: [activeDocument], deleted_documents: [] })
    await mountProfile(api)
    vi.useFakeTimers()
    for (const studentNumber of ["20230020999", "invalid999"]) {
      fireEvent.change(screen.getByLabelText("学号"), { target: { value: studentNumber } })
      expect(screen.getByLabelText("毕业届别")).toHaveValue("2031届")
      expect(screen.getByLabelText("学院")).toHaveValue(profile.college)
      expect(screen.getByLabelText("专业")).toHaveValue(profile.major)
      expect(screen.getByLabelText("班级")).toHaveValue(profile.class_name)
    }
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "202399999999" } })
    expect(screen.getByLabelText("毕业届别")).toHaveValue("2027届")
    expect(screen.getByLabelText("学院")).toHaveValue(profile.college)
    expect(screen.getByLabelText("专业")).toHaveValue(profile.major)
    expect(screen.getByLabelText("班级")).toHaveValue(profile.class_name)
  })

  it("preserves manual academic corrections through later saves and workspace reload", async () => {
    const api = mockApi()
    const activeDocument = documentFixture()
    let persistedProfileDraft: StudentProfileDraft = { ...completeProfileDraft }
    vi.mocked(api.openWorkspace).mockImplementation(async () => ({ mode: "persistent", profile, profile_draft: persistedProfileDraft, document: activeDocument, documents: [activeDocument], deleted_documents: [] }))
    vi.mocked(api.saveProfileDraft).mockImplementation(async (next) => {
      persistedProfileDraft = { ...next }
      return persistedProfileDraft
    })
    const firstRender = await mountProfile(api)
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "202300202999" } })
    expect(screen.getByLabelText("学院")).toHaveValue("人工智能学院")
    fireEvent.change(screen.getByLabelText("毕业届别"), { target: { value: "2031届" } })
    fireEvent.change(screen.getByLabelText("学院"), { target: { value: "人工修正学院" } })
    fireEvent.change(screen.getByLabelText("专业"), { target: { value: "人工修正专业" } })
    fireEvent.change(screen.getByLabelText("班级"), { target: { value: "人工修正班级" } })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    fireEvent.change(screen.getByLabelText("指导教师职称"), { target: { value: "教授" } })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(api.saveProfileDraft).toHaveBeenLastCalledWith(expect.objectContaining({ student_number: "202300202999", graduation_cohort: "2031届", college: "人工修正学院", major: "人工修正专业", class_name: "人工修正班级" }), profile.id)
    expect(api.saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ student_number: "202300202999", graduation_cohort: "2031届", college: "人工修正学院", major: "人工修正专业", class_name: "人工修正班级" }))
    expect(api.saveDraft).not.toHaveBeenCalled()
    vi.useRealTimers()
    firstRender.unmount()
    await mountProfile(api)
    expect(screen.getByLabelText("学号")).toHaveValue("202300202999")
    expect(screen.getByLabelText("毕业届别")).toHaveValue("2031届")
    expect(screen.getByLabelText("学院")).toHaveValue("人工修正学院")
    expect(screen.getByLabelText("专业")).toHaveValue("人工修正专业")
    expect(screen.getByLabelText("班级")).toHaveValue("人工修正班级")
  })

  it.each([
    ["中德智能制造学院", "机械设计制造及其自动化", "机械1班", "", ""],
    ["大数据与互联网学院", "计算机科学与技术", "计算机1班", "计算机科学与技术", "计算机1班"],
  ])("keeps only a compatible previous major when synthetic number identifies a college but no major (%s)", async (college, major, className, expectedMajor, expectedClass) => {
    const api = mockApi()
    const academicProfile = { ...profile, college, major, class_name: className }
    const activeDocument = documentFixture()
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: academicProfile, profile_draft: null, document: activeDocument, documents: [activeDocument], deleted_documents: [] })
    await mountProfile(api)
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "202300209999" } })
    expect(screen.getByLabelText("学院")).toHaveValue("人工智能学院")
    expect(screen.getByLabelText("专业")).toHaveValue(expectedMajor)
    expect(screen.getByLabelText("班级")).toHaveValue(expectedClass)
  })

  it("retains a compatible class and persists an incompatible class as empty without reviving the old profile value", async () => {
    const api = mockApi()
    const academicProfile = { ...profile, college: "大数据与互联网学院", major: "计算机科学与技术", class_name: "计算机1班" }
    const assessment = documentFixture({ document_type: "advisor_review", schema_version: "0.1", content: assessmentContent(emptyAssessmentDraft(), { title: "合成论文", student_name: profile.full_name, student_id: profile.student_number, college: academicProfile.college, major: academicProfile.major, advisor: profile.advisor_name ?? "", advisor_title: profile.advisor_title ?? "" }) })
    vi.mocked(api.openWorkspace).mockResolvedValue({ mode: "persistent", profile: academicProfile, profile_draft: null, document: assessment, documents: [assessment], deleted_documents: [] })
    await mountProfile(api)
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "202300202999" } })
    expect(screen.getByLabelText("学院")).toHaveValue("人工智能学院")
    expect(screen.getByLabelText("班级")).toHaveValue("计算机1班")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(api.saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ student_number: "202300202999", college: "人工智能学院", major: "计算机科学与技术", class_name: "计算机1班" }))
    fireEvent.change(screen.getByLabelText("学号"), { target: { value: "202200101999" } })
    expect(screen.getByLabelText("班级")).toHaveValue("")
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(api.saveProfileDraft).toHaveBeenLastCalledWith(expect.objectContaining({ student_number: "202200101999", college: "中德智能制造学院", major: "机械设计制造及其自动化", class_name: "" }), profile.id)
    expect(api.saveProfile).toHaveBeenLastCalledWith(expect.objectContaining({ student_number: "202200101999", college: "中德智能制造学院", major: "机械设计制造及其自动化", class_name: "" }))
    expect(api.saveDraft).not.toHaveBeenCalled()
  })
})
