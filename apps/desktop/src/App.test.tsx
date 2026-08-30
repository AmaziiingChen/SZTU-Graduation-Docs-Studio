import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type {
  DocumentRecord,
  ExportPreflightInput,
  SaveDraftResult,
  StudentProfile,
  SztuDesktopApi,
  WorkspaceMode,
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
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
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

function mockApi(): SztuDesktopApi {
  return {
    getAppInfo: vi.fn().mockResolvedValue({
      appVersion: "0.1.0",
      electronVersion: "test",
      platform: "darwin",
    }),
    checkEnvironment: vi.fn().mockResolvedValue(environmentResult),
    openWorkspace: vi.fn().mockResolvedValue({
      mode: "persistent",
      profile,
      document: documentFixture(),
      documents: [documentFixture()],
    }),
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
      document: documentFixture({ id: documentId }),
      documents: [documentFixture({ id: documentId })],
    })),
    saveDraft: vi.fn().mockResolvedValue({
      document_id: "document-fixture",
      revision: 3,
      save_reason: "auto",
      saved_at: "2026-08-30T00:00:01Z",
    }),
    restorePrevious: vi.fn().mockResolvedValue(
      documentFixture({
        current_revision: 3,
        content: {
          ...draftContent,
          metadata: { ...draftContent.metadata, title: "恢复的上一版" },
        },
        save_reason: "restore",
        restored_from_revision: 1,
      }),
    ),
    closeTemporary: vi.fn().mockResolvedValue({
      mode: "persistent",
      profile,
      document: documentFixture(),
      documents: [documentFixture()],
    }),
    checkDocument: vi.fn().mockResolvedValue({ checks: [contentCheck] }),
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
      status: "installed",
      template_id: "sztu.proposal.2026.local",
      version: "0.2+a0799ee",
      pack_sha256: "a".repeat(64),
      installed_at: "2026-08-30T00:00:04Z",
    }),
    recordQa: vi.fn().mockResolvedValue({
      artifact_id: "artifact-docx-fixture",
      check: {
        ...contentCheck,
        check_id: "target-editor-manual",
        gate: "target_editor",
        message: "WPS Office 人工验收已记录。",
      },
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

describe("M3 workbench persistence", () => {
  beforeEach(() => {
    installApi(mockApi())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    delete (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  })

  it("restores the active persistent profile and document", async () => {
    renderApp()

    expect(await screen.findByDisplayValue("合成开题报告")).toBeInTheDocument()
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
    expect(await screen.findByText("基础环境可用")).toBeInTheDocument()
    expect(screen.getByText("开发模板包可用。")).toBeInTheDocument()
    expect(screen.getByText("结构检查")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出" })).toBeEnabled()
  })

  it("creates an unnamed proposal when no active document exists", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockResolvedValue({
      mode: "persistent",
      profile: null,
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

  it("waits 700ms and only shows saved after the backend confirms", async () => {
    const api = mockApi()
    let resolveSave!: (value: SaveDraftResult) => void
    const pendingSave = new Promise<SaveDraftResult>((resolve) => {
      resolveSave = resolve
    })
    vi.mocked(api.saveDraft).mockReturnValue(pendingSave)
    installApi(api)
    renderApp()

    const title = await screen.findByLabelText("论文题目")
    vi.useFakeTimers()
    fireEvent.change(title, { target: { value: "更新后的合成题目" } })
    expect(screen.getByLabelText("保存状态：未保存")).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(699))
    expect(api.saveDraft).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("保存状态：正在保存")).toBeInTheDocument()
    expect(api.saveProfile).toHaveBeenCalledWith({
      id: profile.id,
      full_name: "合成学生甲",
      student_number: "SYN-0001",
      college: "示例学院",
      major: "示例专业",
      class_name: "示例一班",
      advisor_name: "合成教师乙",
    })
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          metadata: expect.objectContaining({
            title: "更新后的合成题目",
            student_name: "合成学生甲",
          }),
          sections: expect.objectContaining({
            significance_and_status: ["第一段", "第二段"],
          }),
        }),
      }),
    )

    await act(async () => {
      resolveSave({
        document_id: "document-fixture",
        revision: 3,
        save_reason: "auto",
        saved_at: "2026-08-30T00:00:01Z",
      })
      await pendingSave
    })
    expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
  })

  it("shows revision conflict without claiming the draft was saved", async () => {
    const api = mockApi()
    vi.mocked(api.saveDraft).mockRejectedValue(
      Object.assign(new Error("stale revision"), { code: "REVISION_CONFLICT" }),
    )
    installApi(api)
    renderApp()

    const title = await screen.findByLabelText("论文题目")
    vi.useFakeTimers()
    fireEvent.change(title, { target: { value: "会发生冲突的合成题目" } })
    await act(async () => vi.advanceTimersByTimeAsync(700))

    expect(screen.getAllByText("修订冲突")).not.toHaveLength(0)
    expect(screen.queryByLabelText("保存状态：已保存")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument()
  })

  it("restores the previous revision through the explicit action", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    const restoreButton = await screen.findByRole("button", {
      name: "恢复上一版",
    })
    fireEvent.click(restoreButton)

    await waitFor(() => expect(api.restorePrevious).toHaveBeenCalledTimes(1))
    expect(api.restorePrevious).toHaveBeenCalledWith({
      documentId: "document-fixture",
      expectedRevision: 2,
    })
    expect(await screen.findByDisplayValue("恢复的上一版")).toBeInTheDocument()
  })

  it("preflights the saved proposal and exports Word plus PDF", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

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
    expect((await screen.findAllByText("最近导出")).length).toBeGreaterThan(0)
    expect(screen.getByText("/tmp/sztu-export-test/proposal.pdf")).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole("button", { name: "导出" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 Word" }))
    const cancelButton = await screen.findByRole("button", { name: "取消导出" })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(api.cancelExport).toHaveBeenCalledTimes(1))
    expect(api.cancelExport).toHaveBeenCalledWith(expect.any(String))
    expect(cancelButton).toBeDisabled()

    await act(async () => {
      rejectExport(Object.assign(new Error("cancelled"), { code: "EXPORT_CANCELLED" }))
    })
    expect(await screen.findByText("导出已取消，未完成的临时产物已清理。")).toBeInTheDocument()
  })

  it("refreshes history, opens artifacts, and records only explicit manual QA", async () => {
    const api = mockApi()
    vi.mocked(api.listExportHistory).mockResolvedValue({
      schema_version: "1.0",
      history: [historyJob],
    })
    installApi(api)
    renderApp()

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
  })

  it("installs a selected trusted template and refreshes environment checks", async () => {
    const api = mockApi()
    installApi(api)
    renderApp()

    fireEvent.click(
      await screen.findByRole("button", { name: "选择并安装受信任模板" }),
    )
    await waitFor(() => expect(api.installTemplatePack).toHaveBeenCalledTimes(1))
    expect(api.installTemplatePack).toHaveBeenCalledWith("proposal")
    await waitFor(() => expect(api.checkEnvironment).toHaveBeenCalledTimes(2))
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
      document: proposal,
      documents: [proposal, midterm],
    })
    vi.mocked(api.selectDocument).mockResolvedValue({
      mode: "persistent",
      profile,
      document: midterm,
      documents: [proposal, midterm],
    })
    installApi(api)
    renderApp()

    fireEvent.click(await screen.findByRole("button", { name: /中期检查/ }))
    await waitFor(() =>
      expect(api.selectDocument).toHaveBeenCalledWith("midterm-document"),
    )
    expect(await screen.findByText("2026 届中期检查表")).toBeInTheDocument()
    expect(screen.getByLabelText("检查日期")).toHaveValue("2026-03-26")
    expect(screen.getByLabelText("论文目录")).toHaveValue("1 绪论\n1.1 研究背景")
    expect(screen.queryByLabelText("学生姓名")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学号")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("学院")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("专业")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("班级")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("指导教师")).not.toBeInTheDocument()
    expect(screen.getByText("中期检查填写边界")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "学生档案" }))
    expect(await screen.findByRole("heading", { name: "学生档案" })).toBeInTheDocument()
    expect(screen.getByLabelText("学生姓名")).toHaveValue("合成学生甲")
    expect(screen.getByLabelText("学号")).toHaveValue("SYN-0001")
    expect(screen.getByLabelText("班级")).toHaveValue("示例一班")
    expect(screen.queryByRole("button", { name: "检查内容" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /中期检查/ }))

    fireEvent.click(screen.getByRole("button", { name: "选择并安装受信任模板" }))
    await waitFor(() =>
      expect(api.installTemplatePack).toHaveBeenCalledWith("midterm"),
    )
  })

  it("enters temporary mode and requires explicit discard before returning", async () => {
    const api = mockApi()
    vi.mocked(api.openWorkspace).mockImplementation(async (mode: WorkspaceMode) =>
      mode === "temporary"
        ? { mode, profile: null, document: null, documents: [] }
        : {
            mode,
            profile,
            document: documentFixture(),
            documents: [documentFixture()],
          },
    )
    vi.mocked(api.createDocument).mockResolvedValue(
      documentFixture({
        id: "temporary-document",
        profile_id: null,
        is_temporary: true,
        current_revision: 0,
        content: null,
        saved_at: null,
        save_reason: null,
      }),
    )
    installApi(api)
    renderApp()

    const temporaryButton = await screen.findByRole("button", {
      name: "临时模式",
    })
    fireEvent.click(temporaryButton)
    expect(
      await screen.findByRole("button", { name: "返回持久工作区" }),
    ).toBeInTheDocument()
    expect(screen.getAllByText("临时模式").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "返回持久工作区" }))
    expect(await screen.findByText("丢弃临时内容？")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "丢弃并返回" }))

    await waitFor(() =>
      expect(api.closeTemporary).toHaveBeenCalledWith("temporary-document"),
    )
    expect(await screen.findByDisplayValue("合成开题报告")).toBeInTheDocument()
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

    expect(await screen.findByText("文档引擎未连接")).toBeInTheDocument()
    expect(screen.getByText("SIDECAR_EXITED")).toBeInTheDocument()
  })
})
