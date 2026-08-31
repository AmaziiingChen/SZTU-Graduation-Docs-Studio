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
      id: "template_pack",
      required: true,
      status: "pass" as const,
      message: "开发模板包可用。",
    },
    {
      id: "proposal_engine",
      required: false,
      status: "pass" as const,
      message: "开题报告本地模板工程已实时同步为导出快照。",
      details: { source: "development-workspace", live_workspace: true },
    },
    {
      id: "midterm_engine",
      required: false,
      status: "pass" as const,
      message: "中期检查本地模板工程已实时同步为导出快照。",
      details: { source: "development-workspace", live_workspace: true },
    },
    {
      id: "task_book_engine",
      required: false,
      status: "pass" as const,
      message: "任务书本地模板工程已实时同步为导出快照。",
      details: { source: "development-workspace", live_workspace: true },
    },
  ],
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
  message: "开题报告必填字段和段落结构已通过严格检查。",
  checked_at: "2026-08-30T00:00:02Z",
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
  checks: [contentCheck],
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
  checks: [contentCheck],
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
      checks: [],
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
          { period: "第1—2周", content: "完成文献调研和需求分析。" },
          { period: "第3—6周", content: "完成系统实现和测试。" },
        ],
        required_materials: ["学校发布的过程文档规范。"],
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
    getAppInfo: vi.fn().mockResolvedValue({
      appVersion: "0.1.0",
      electronVersion: "test",
      platform: "darwin",
    }),
    checkEnvironment: vi.fn().mockResolvedValue(environmentResult),
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
    recordTelemetry: vi.fn().mockResolvedValue(null),
    getUpdateStatus: vi.fn().mockResolvedValue({ state: "unconfigured" }),
    revealDownloadedUpdate: vi.fn().mockResolvedValue(null),
    onUpdateStatus: vi.fn().mockReturnValue(() => undefined),
    openWorkspace: vi.fn().mockResolvedValue({
      mode: "persistent",
      profile,
      profile_draft: null,
      document: documentFixture(),
      documents: [documentFixture()],
    }),
    saveProfileDraft: vi.fn().mockImplementation(async (profileDraft) => profileDraft),
    saveProfile: vi.fn().mockResolvedValue(profile),
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
    openExportArtifact: vi.fn().mockResolvedValue({
      artifact_id: "artifact-docx-fixture",
      opened: true,
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

function replaceRichText(element: HTMLElement, value: string) {
  element.focus()
  fireEvent.keyDown(element, {
    key: "a",
    code: "KeyA",
    metaKey: true,
    ctrlKey: true,
  })
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
  if (!screen.queryByRole("button", { name: "检查与导出" })) {
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    )
  }
  fireEvent.click(
    await screen.findByRole("button", { name: "检查与导出" }),
  )
}

async function openSharedThesisTitle() {
  if (!screen.queryByRole("button", { name: "学生档案" })) {
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    )
  }
  fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
  return screen.findByRole("textbox", { name: "论文题目" })
}

async function generateCurrentPreview(api: SztuDesktopApi) {
  fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
  fireEvent.click(
    await screen.findByRole("button", { name: "生成排版预览" }),
  )
  await waitFor(() =>
    expect(api.generatePreview).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "document-fixture",
    }),
  )
  expect(
    await screen.findByRole("img", { name: "排版预览第 1 页" }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
}

describe("M3 workbench persistence", () => {
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

  it("shows a concise privacy notice without a false development warning", async () => {
    const api = mockApi()
    vi.mocked(api.getPrivacyNoticeStatus).mockResolvedValue({
      noticeVersion: "1.1",
      acknowledged: false,
      acceptedAt: null,
      telemetryConfigured: true,
      updateConfigured: false,
      configurationRequired: false,
    })
    installApi(api)

    renderApp()

    expect(
      await screen.findByRole("dialog", {
        name: "使用说明与隐私告知",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/必要的匿名运行信息/)).toBeInTheDocument()
    expect(screen.queryByText("当前开发构建尚未配置远程服务")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "同意并继续" }))

    await waitFor(() => expect(api.acceptPrivacyNotice).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "使用说明与隐私告知" }),
      ).not.toBeInTheDocument(),
    )
  })

  it("restores the active persistent profile and document", async () => {
    renderApp()

    expect(
      await screen.findByLabelText("保存状态：已保存"),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "排版预览" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("尚未生成预览")).not.toBeInTheDocument()
    expect(screen.queryByText("本机环境")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
  })

  it("uses the official dashboard shell composition", async () => {
    const { container } = renderApp()

    await screen.findByRole("button", { name: "检查内容" })
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      "data-variant",
      "inset",
    )
    expect(
      container
        .querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')
        ?.style.getPropertyValue("--sidebar-width"),
    ).toBe("14rem")
    expect(container.querySelector('[data-slot="sidebar-inset"]')).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { level: 1, name: "2026届开题报告工作台" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("本地工作台")).not.toBeInTheDocument()
    expect(screen.queryByText("可用")).not.toBeInTheDocument()
    expect(screen.queryByText("待接入")).not.toBeInTheDocument()
    expect(screen.queryByText("数据默认仅保存在本机")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "毕业论文" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("button", { name: "毕业论文" })).toHaveClass(
      "text-muted-foreground",
    )
    const header = container.querySelector("header")
    expect(header).not.toBeNull()
    expect(within(header!).getByRole("button", { name: "检查内容" })).toBeInTheDocument()
    expect(within(header!).getByRole("button", { name: "排版预览" })).toBeInTheDocument()
    expect(within(header!).getByRole("button", { name: "导出" })).toBeInTheDocument()
    expect(
      (await screen.findByRole("textbox", {
        name: "本选题的意义及国内外发展状况",
      })).closest('[data-slot="card"]'),
    ).toHaveClass("border-0", "shadow-none")
    expect(screen.queryByRole("button", { name: "预览与检查" })).not.toBeInTheDocument()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
  })

  it("keeps profile suggestions editable and applies the selected cohort to workspace titles", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
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

    fireEvent.click(screen.getByRole("button", { name: "开题报告" }))
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "秋季毕业批次开题报告工作台",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText("秋季毕业批次开题报告")).toBeInTheDocument()
  })

  it("keeps multiple advisors paired with their titles in user-defined order", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    const firstTitle = screen.getByLabelText("指导教师职称")
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
    fireEvent.click(screen.getByRole("button", { name: "上移第2指导教师" }))

    expect(screen.getByLabelText("指导教师")).toHaveValue("合成教师丙")
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("实验师")
    expect(screen.getByLabelText("第2指导教师")).toHaveValue("合成教师乙")
    expect(screen.getByLabelText("第2指导教师职称")).toHaveValue("副教授")

    await waitFor(
      () =>
        expect(api.saveProfileDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            advisor_name: "合成教师丙、合成教师乙",
            advisor_title: "实验师、副教授",
          }),
        ),
      { timeout: 2_000 },
    )
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        advisor_name: "合成教师丙、合成教师乙",
        advisor_title: "实验师、副教授",
      }),
    )
  })

  it("normalizes only plain four-digit cohorts and enforces the 20-character boundary", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
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
    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
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

    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    expect(screen.getByLabelText("班级")).toHaveValue("新能源2班")

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "教授" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith(
      expect.objectContaining({ class_name: "新能源2班" }),
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
      screen.getByRole("heading", { level: 1, name: "检查与导出" }),
    ).toBeInTheDocument()
    expect(screen.getByText("本机环境")).toBeInTheDocument()
    expect(screen.getByText("文档质量")).toBeInTheDocument()
    expect(screen.queryByText("尚未生成预览")).not.toBeInTheDocument()
    expect(screen.queryByText("预览与检查")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "开题报告" }))
    expect(
      (await screen.findAllByRole("heading", {
        level: 1,
        name: "2026届开题报告",
      })).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole("textbox", { name: "论文题目" })).toBeNull()
    expect(await openSharedThesisTitle()).toHaveTextContent("合成开题报告")
  })

  it("generates a paginated preview only after the explicit action", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    expect(screen.queryByRole("img", { name: "排版预览第 1 页" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
    expect(
      await screen.findByRole("dialog", { name: "排版预览" }),
    ).toBeInTheDocument()
    expect(api.generatePreview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "生成排版预览" }))
    await waitFor(() =>
      expect(api.generatePreview).toHaveBeenCalledWith({
        requestId: expect.any(String),
        documentId: "document-fixture",
      }),
    )
    expect(
      await screen.findByRole("img", { name: "排版预览第 1 页" }),
    ).toBeInTheDocument()
    expect(screen.getByText("当前有效")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
  })

  it("marks the generated preview stale as soon as input changes", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    replaceRichText(
      screen.getByRole("textbox", { name: "本选题的意义及国内外发展状况" }),
      "预览后修改的选题意义",
    )

    fireEvent.click(screen.getByRole("button", { name: "排版预览" }))
    expect(screen.getByText("预览已过期")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
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

    fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "生成排版预览" }),
    )
    await waitFor(() => expect(api.generatePreview).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    replaceRichText(
      screen.getByRole("textbox", { name: "本选题的意义及国内外发展状况" }),
      "预览生成期间修改的选题意义",
    )
    await act(async () => {
      resolvePreview(previewResult)
      await pendingPreview
    })

    fireEvent.click(screen.getByRole("button", { name: "排版预览" }))
    expect(await screen.findByText("预览已过期")).toBeInTheDocument()
    expect(screen.queryByText("当前有效")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
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

    const exportButton = await screen.findByRole("button", { name: "导出" })
    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAttribute(
      "title",
      "请先在左侧“检查与导出”中关联可用的本地模板工程",
    )
    fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
    expect(await screen.findByText("暂时无法生成预览")).toBeInTheDocument()
  })

  it("creates an unnamed proposal when no active document exists", async () => {
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
      title: "未命名开题报告",
    })
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole("button", { name: "排版预览" }))
    fireEvent.click(screen.getByRole("button", { name: "生成排版预览" }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

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
    fireEvent.change(
      screen.getByRole("textbox", { name: "参考文献 BibTeX" }),
      { target: { value: source } },
    )

    expect(
      screen.getByText(
        "[1] 张三, 李四. 合成参考文献[J]. 深圳技术大学学报, 2026, 2(1): 1-8.",
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
                text: "[1] 张三, 李四. 合成参考文献[J]. 深圳技术大学学报, 2026, 2(1): 1-8.",
              },
            ],
          },
        ],
      },
    })
  })

  it("retains the last valid generated references for invalid BibTeX and clears them with the source", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /参考文献/ }))
    const sourceInput = screen.getByRole("textbox", {
      name: "参考文献 BibTeX",
    })
    const validSource =
      "@article{valid, author={张三}, title={可用条目}, journal={合成期刊}, year={2026}}"
    fireEvent.change(sourceInput, { target: { value: validSource } })

    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })
    const validReferences = (
      vi.mocked(api.saveDraft).mock.calls[0][0].content.sections as JsonObject
    ).references
    vi.mocked(api.saveDraft).mockClear()

    const invalidSource = "@article{broken, title={缺少作者和期刊}}"
    fireEvent.change(sourceInput, { target: { value: invalidSource } })
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    })
    const invalidContent = vi.mocked(api.saveDraft).mock.calls[0][0].content
    expect(invalidContent).toMatchObject({
      editor_state: {
        bibliography: {
          source_text: invalidSource,
          parse_status: "invalid",
        },
      },
      sections: { references: validReferences },
    })
    vi.mocked(api.saveDraft).mockClear()

    fireEvent.change(sourceInput, { target: { value: "" } })
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
    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("学生姓名"), {
      target: { value: "只填写了姓名" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...emptyProfileDraft,
      full_name: "只填写了姓名",
    })
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()

    vi.useRealTimers()
    firstRender.unmount()
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
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
    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...completeProfileDraft,
      advisor_title: "",
    })
    expect(api.saveProfile).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()

    vi.useRealTimers()
    firstRender.unmount()
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("")
    expect(screen.getByText("请输入指导教师职称。")).toBeInTheDocument()
  })

  it("saves profile-only changes without touching a conflicting document revision", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValue(
      Object.assign(new Error("stale revision"), { code: "REVISION_CONFLICT" }),
    )
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "学生档案" }))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText("指导教师职称"), {
      target: { value: "教授" },
    })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(api.saveProfileDraft).toHaveBeenCalledWith({
      ...completeProfileDraft,
      advisor_title: "教授",
    })
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ advisor_title: "教授" }),
    )
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
    expect(screen.queryByText("修订冲突")).not.toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole("button", { name: "检查内容" }))

    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        "请先打开左侧“学生档案”，补全姓名、学号、毕业届别、学院、专业、班级、指导教师和职称。",
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

    expect(screen.getAllByText("修订冲突")).not.toHaveLength(0)
    expect(screen.queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "检查内容" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "排版预览" })).toBeDisabled()
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
      outputDirectory: "/tmp/sztu-export-test",
      formats: ["docx", "pdf"],
    })
    expect(api.exportDocument).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "document-fixture",
      outputDirectory: "/tmp/sztu-export-test",
      formats: ["docx", "pdf"],
      overwriteConfirmed: false,
      preflightToken: "e".repeat(64),
    })
    await openOperationsPanel()
    expect(screen.getByText("/tmp/sztu-export-test/proposal.pdf")).toBeInTheDocument()
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
      screen.getByRole("textbox", { name: "本选题的意义及国内外发展状况" }),
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
        outputDirectory: "/tmp/sztu-export-test",
        formats: ["tex"],
      }),
    )
    expect(api.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ formats: ["tex"], overwriteConfirmed: false }),
    )
    await openOperationsPanel()
    expect(
      await screen.findByText("/tmp/sztu-export-test/开题报告-LaTeX.zip"),
    ).toBeInTheDocument()
  })

  it("requires explicit confirmation before overwriting an existing output", async () => {
    const api = mockApi()
    vi.mocked(api.preflightExport).mockResolvedValue({
      ...preflightResult,
      targets: [
        {
          format: "docx",
          filename: "开题报告.docx",
          path: "/tmp/sztu-export-test/开题报告.docx",
          exists: true,
        },
      ],
      overwrite_required: true,
    })
    installApi(api)
    renderApp()

    await generateCurrentPreview(api)
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))

    expect(await screen.findByText("目标文件已存在")).toBeInTheDocument()
    expect(api.exportDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认覆盖并导出" }))

    await waitFor(() => expect(api.exportDocument).toHaveBeenCalledTimes(1))
    expect(api.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({ overwriteConfirmed: true }),
    )
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
    await openOperationsPanel()
    const cancelButton = await screen.findByRole("button", { name: "取消导出" })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(api.cancelExport).toHaveBeenCalledTimes(1))
    expect(api.cancelExport).toHaveBeenCalledWith(expect.any(String))
    expect(cancelButton).toBeDisabled()

    await act(async () => {
      rejectExport(Object.assign(new Error("cancelled"), { code: "EXPORT_CANCELLED" }))
    })
    expect(
      (await screen.findAllByText("导出已取消，未完成的临时产物已清理。"))
        .length,
    ).toBeGreaterThan(0)
  })

  it("refreshes history, opens artifacts, and records only explicit manual QA", async () => {
    const api = mockApi()
    const pendingTargetEditorCheck = {
      ...contentCheck,
      check_id: "target-editor-pending",
      gate: "target_editor" as const,
      status: "not_checked" as const,
      blocking: false,
      message: "尚未记录当前导出产物的 Word/WPS 人工验收。",
    }
    vi.mocked(api.checkDocument).mockResolvedValue({
      checks: [contentCheck, pendingTargetEditorCheck],
    })
    vi.mocked(api.listExportHistory).mockResolvedValue({
      schema_version: "1.0",
      history: [historyJob],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: "检查内容" }))
    await waitFor(() => expect(api.checkDocument).toHaveBeenCalledTimes(1))
    await openOperationsPanel()
    expect(
      await screen.findByText("尚未记录当前导出产物的 Word/WPS 人工验收。"),
    ).toBeInTheDocument()
    expect(await screen.findByText("开题报告.docx")).toBeInTheDocument()
    expect(screen.getByText("Word/WPS 人工验收未记录")).toBeInTheDocument()
    expect(api.recordQa).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "打开产物" }))
    await waitFor(() =>
      expect(api.openExportArtifact).toHaveBeenCalledWith("artifact-docx-fixture"),
    )

    fireEvent.click(screen.getByRole("button", { name: "记录人工验收" }))
    expect(await screen.findByText("记录 Word/WPS 人工验收")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("验收备注（可选）"), {
      target: { value: "已在虚构环境逐页检查。" },
    })
    fireEvent.click(screen.getByRole("button", { name: "WPS 验收通过" }))

    await waitFor(() => expect(api.recordQa).toHaveBeenCalledTimes(1))
    expect(api.recordQa).toHaveBeenCalledWith({
      artifactId: "artifact-docx-fixture",
      gate: "target_editor",
      status: "pass",
      editor: "wps",
      message: "已在虚构环境逐页检查。",
    })
    expect(await screen.findByText("WPS Office 人工验收已记录。")).toBeInTheDocument()
    expect(
      screen.queryByText("尚未记录当前导出产物的 Word/WPS 人工验收。"),
    ).not.toBeInTheDocument()
  })

  it("links a local template workspace and refreshes environment checks", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "关联或更新本地模板工程" }))
    await waitFor(() => expect(api.installTemplatePack).toHaveBeenCalledTimes(1))
    expect(api.installTemplatePack).toHaveBeenCalledWith("proposal")
    await waitFor(() => expect(api.checkEnvironment).toHaveBeenCalledTimes(2))
  })

  it("switches to the submitted task-book template without repeating shared profile fields", async () => {
    const api = mockApi()
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

    fireEvent.click(await screen.findByRole("button", { name: /任务书/ }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("task-book-document"),
    )

    expect(
      await screen.findByText("2026届本科毕业论文（设计）任务书"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "论文题目" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /基本内容和要求/ }))
    expect(
      screen.getByRole("textbox", { name: "基本内容和要求" }),
    ).toHaveTextContent(
      "完成统一数据模型和双路文档渲染。",
    )
    fireEvent.click(screen.getByRole("button", { name: /进度安排/ }))
    expect(screen.getByLabelText("第 1 项时间范围")).toHaveValue("第1—2周")
    expect(screen.getByRole("textbox", { name: "第 1 项进度内容" })).toHaveTextContent(
      "完成文献调研和需求分析。",
    )
    expect(screen.getByLabelText("第 2 项时间范围")).toHaveValue("第3—6周")
    fireEvent.click(screen.getByRole("button", { name: /选题信息/ }))
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
      target: { value: "第7周" },
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
              expect.objectContaining({ period: "第1—2周" }),
              expect.objectContaining({ period: "第3—6周" }),
              expect.objectContaining({
                period: "第7周",
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
    fireEvent.click(screen.getByRole("button", { name: "关联或更新本地模板工程" }))
    await waitFor(() =>
      expect(api.installTemplatePack).toHaveBeenCalledWith("task_book"),
    )
  })

  it("keeps one shared thesis title after switching documents", async () => {
    const api = mockApi()
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

    fireEvent.click(await screen.findByRole("button", { name: /任务书/ }))
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
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /任务书/ }))
    await waitFor(() =>
      expect(api.createDocument).toHaveBeenCalledWith({
        profile_id: profile.id,
        document_type: "task_book",
        template_version: "0.1+46b6d97",
        schema_version: "0.1",
        title: "未命名任务书",
      }),
    )
    expect(
      await screen.findByText("2026届本科毕业论文（设计）任务书"),
    ).toBeInTheDocument()
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
    expect(
      screen.getByText("第 1 项缺少时间范围。"),
    ).toBeInTheDocument()
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
    expect(screen.getByLabelText("第 3 项时间范围")).toHaveValue("")
    expect(screen.getByText("第 3 项缺少时间范围。")).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "生成排版预览" }),
    )
    await waitFor(() =>
      expect(api.checkDocument).toHaveBeenCalledWith("task-book-document"),
    )
    await waitFor(() =>
      expect(api.generatePreview).toHaveBeenCalledWith({
        requestId: expect.any(String),
        documentId: "task-book-document",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))

    await waitFor(() =>
      expect(api.preflightExport).toHaveBeenCalledWith({
        documentId: "task-book-document",
        outputDirectory: "/tmp/sztu-export-test",
        formats: ["docx"],
      }),
    )
    expect(api.exportDocument).toHaveBeenCalledWith({
      requestId: expect.any(String),
      documentId: "task-book-document",
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
    fireEvent.click(screen.getByRole("button", { name: "检查内容" }))
    expect(
      await screen.findByText(/任务书必须从学生档案的毕业届别提取四位年份/),
    ).toBeInTheDocument()
    expect(api.checkDocument).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled()
  })

  it("switches to an existing midterm document and exposes only student-owned fields", async () => {
    const api = mockApi()
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
          check_date: "2026-03-26",
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

    fireEvent.click(await screen.findByRole("button", { name: /中期检查/ }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("midterm-document"),
    )
    expect(await screen.findByText("2026届中期检查表")).toBeInTheDocument()
    const checkDate = screen.getByLabelText("检查日期")
    expect(checkDate.closest('[data-slot="card"]')).toHaveClass(
      "border-0",
      "shadow-none",
    )
    expect(checkDate).toHaveTextContent("2026年3月26日")
    fireEvent.click(checkDate)
    fireEvent.click(screen.getByRole("button", { name: /30/ }))
    expect(checkDate).toHaveTextContent("2026年3月30日")
    fireEvent.click(screen.getByRole("button", { name: /论文目录/ }))
    expect(screen.getByLabelText("第 1 条目录编号")).toHaveValue("1")
    expect(
      screen.getByRole("button", { name: "第 1 条目录标题" }),
    ).toHaveTextContent("绪论")
    expect(screen.getByLabelText("第 2 条目录编号")).toHaveValue("1.1")
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

    fireEvent.click(screen.getByRole("button", { name: "学生档案" }))
    expect(await screen.findByRole("heading", { name: "学生档案" })).toBeInTheDocument()
    expect(screen.getByLabelText("学生姓名")).toHaveValue("合成学生甲")
    expect(screen.getByLabelText("学号")).toHaveValue("SYN-0001")
    expect(screen.getByLabelText("班级")).toHaveValue("示例一班")
    expect(screen.getByLabelText("指导教师职称")).toHaveValue("副教授")
    expect(screen.getByLabelText("毕业届别")).toHaveValue("2026届")
    expect(screen.queryByText("排版预览")).not.toBeInTheDocument()
    expect(screen.queryByText("档案与导出快照")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "检查内容" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /中期检查/ }))

    await openOperationsPanel()
    fireEvent.click(screen.getByRole("button", { name: "关联或更新本地模板工程" }))
    await waitFor(() =>
      expect(api.installTemplatePack).toHaveBeenCalledWith("midterm"),
    )
  })

  it("preserves an existing image block instead of crashing the text editor", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: /主要研究内容/ }))

    expect(
      await screen.findByText("本栏包含暂不支持编辑的内容块"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "论文主要研究内容" })).toBeNull()
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

    fireEvent.click(await screen.findByRole("button", { name: "排版预览" }))
    expect(await screen.findByText("暂时无法生成预览")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await openOperationsPanel()
    expect(screen.getByText("文档引擎未连接")).toBeInTheDocument()
    expect(screen.getByText("SIDECAR_EXITED")).toBeInTheDocument()
  })
})
