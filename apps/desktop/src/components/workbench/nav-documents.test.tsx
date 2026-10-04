import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Sidebar, SidebarContent, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { NavDocuments } from "@/components/workbench/nav-documents"
import type { DocumentRecord } from "@/types/desktop-api"

afterEach(cleanup)

function documentRecord(
  id: string,
  title: string,
  documentType: DocumentRecord["document_type"] = "proposal",
): DocumentRecord {
  return {
    id,
    profile_id: "profile-fixture",
    document_type: documentType,
    template_version: "fixture",
    schema_version: "fixture",
    title,
    status: "draft",
    is_temporary: false,
    current_revision: 1,
    content: { body: title },
    save_reason: "auto",
    saved_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    soft_deleted_at: null,
  }
}

function renderNavigation({
  studentName = "合成学生甲",
  documents = [documentRecord("proposal-a", "开题报告第一版")],
  deletedDocuments = [],
  disabled = false,
  documentsHasMore = false,
  deletedDocumentsHasMore = false,
}: {
  studentName?: string
  documents?: DocumentRecord[]
  deletedDocuments?: DocumentRecord[]
  disabled?: boolean
  documentsHasMore?: boolean
  deletedDocumentsHasMore?: boolean
} = {}) {
  const callbacks = {
    onSelectDocument: vi.fn().mockResolvedValue(undefined),
    onSelectThesisTool: vi.fn(),
    onCreateDocument: vi.fn().mockResolvedValue(undefined),
    onRenameDocument: vi.fn().mockResolvedValue(undefined),
    onDeleteDocument: vi.fn().mockResolvedValue(undefined),
    onRestoreDocument: vi.fn().mockResolvedValue(undefined),
    onPurgeDocument: vi.fn().mockResolvedValue(undefined),
    onClearTrash: vi.fn().mockResolvedValue(undefined),
    onLoadMoreDocuments: vi.fn().mockResolvedValue(undefined),
  }
  const navigation = (nextDocuments = documents) => (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <NavDocuments
              studentName={studentName}
              profileActive={false}
              toolsActive={false}
              inspectionActive={false}
              thesisToolsActive={false}
              activeThesisTool="three_line_table"
              activeDocumentId={nextDocuments[0]?.id ?? null}
              documents={nextDocuments}
              deletedDocuments={deletedDocuments}
              documentsHasMore={documentsHasMore}
              deletedDocumentsHasMore={deletedDocumentsHasMore}
              disabled={disabled}
              {...callbacks}
            />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </TooltipProvider>
  )
  const view = render(navigation())
  return { ...callbacks, rerenderDocuments: (nextDocuments: DocumentRecord[]) => view.rerender(navigation(nextDocuments)) }
}

describe("NavDocuments file tree", () => {
  it("confirms clearing the recycle bin and prevents repeated submission while pending", async () => {
    const callbacks = renderNavigation({ deletedDocuments: [documentRecord("trash-a", "合成回收文档")], deletedDocumentsHasMore: true })
    fireEvent.click(screen.getByRole("button", { name: /回收站（已载入/ }))
    fireEvent.click(screen.getByRole("button", { name: "清空回收站", exact: true }))
    const dialog = screen.getByRole("dialog", { name: "清空回收站？" })
    expect(dialog).toHaveTextContent("所有文档")
    expect(dialog).toHaveTextContent("且无法恢复")
    expect(callbacks.onClearTrash).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(callbacks.onClearTrash).not.toHaveBeenCalled()
    let finish!: () => void
    callbacks.onClearTrash.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole("button", { name: "清空回收站", exact: true }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空回收站", exact: true }))
    expect(callbacks.onClearTrash).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "正在清空…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("keeps a failed clear operation available for retry and has no clear action for an empty bin", async () => {
    const empty = renderNavigation()
    fireEvent.click(screen.getByRole("button", { name: "回收站（0 个文档）" }))
    expect(screen.queryByRole("button", { name: "清空回收站" })).toBeNull()
    cleanup()
    const callbacks = renderNavigation({ deletedDocuments: [documentRecord("trash-a", "合成回收文档")] })
    callbacks.onClearTrash.mockRejectedValueOnce(new Error("合成删除失败"))
    fireEvent.click(screen.getByRole("button", { name: "回收站（1 个文档）" }))
    fireEvent.click(screen.getByRole("button", { name: "清空回收站", exact: true }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空回收站", exact: true }))
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("合成删除失败"))
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "清空回收站", exact: true })).toBeEnabled()
    expect(empty.onClearTrash).not.toHaveBeenCalled()
  })
  it.each([
    ["task_book", "任务书", "任务书"],
    ["proposal", "开题报告", "开题报告"],
    ["midterm", "中期检查", "中期检查表"],
    ["thesis", "毕业论文", "毕业论文"],
    ["advisor_review", "指导教师评审表", "指导教师评审表"],
    ["reviewer_review", "评阅人评审表", "评阅人评审表"],
    ["defense_record", "答辩记录表", "答辩记录表"],
    ["grade_assessment", "成绩考核表", "成绩考核表"],
  ])("defaults a new %s file to the current student name and document label", async (type, label, filenameLabel) => {
    const callbacks = renderNavigation({ studentName: "  合成学生乙  " })
    fireEvent.click(screen.getByRole("button", { name: `新建${label}` }))
    expect(screen.getByLabelText("文件名")).toHaveValue(`合成学生乙-${filenameLabel}`)
    fireEvent.click(screen.getByRole("button", { name: "新建", exact: true }))
    await waitFor(() => expect(callbacks.onCreateDocument).toHaveBeenCalledWith({
      type, title: `合成学生乙-${filenameLabel}`, sourceDocumentId: undefined,
    }))
  })

  it("uses the document label when the student name is still empty", () => {
    renderNavigation({ studentName: "  " })
    fireEvent.click(screen.getByRole("button", { name: "新建任务书" }))
    expect(screen.getByLabelText("文件名")).toHaveValue("任务书")
  })

  it("offers separate continuation actions for documents and the recycle bin", () => {
    const callbacks = renderNavigation({ documentsHasMore: true, deletedDocumentsHasMore: true })
    fireEvent.click(screen.getByRole("button", { name: "加载更多文档", exact: true }))
    expect(callbacks.onLoadMoreDocuments).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole("button", { name: /回收站（已载入/ }))
    fireEvent.click(screen.getByRole("button", { name: "加载更多回收站文档", exact: true }))
    expect(callbacks.onLoadMoreDocuments).toHaveBeenCalledWith(true)
  })

  it("reveals the active document after an asynchronous workspace restore", () => {
    const navigation = renderNavigation({ documents: [] })
    const assessment = documentRecord("assessment-restored", "考核表第二稿", "grade_assessment")
    navigation.rerenderDocuments([assessment])

    expect(screen.getByRole("button", { name: "成绩考核表", exact: true })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "考核表第二稿", exact: true })).toBeVisible()
  })

  it("keeps the document action aligned and reserves text space without overlap", () => {
    const longTitle = "未命名开题报告—材料与方法补充修订版"
    renderNavigation({ documents: [documentRecord("proposal-long", longTitle)] })

    const fileButton = screen.getByRole("button", { name: longTitle })
    const action = screen.getByRole("button", { name: `管理文档 ${longTitle}` })
    const submenu = fileButton.closest('[data-slot="sidebar-menu-sub"]')

    expect(submenu).toHaveClass("mr-0", "pr-0")
    expect(fileButton).toHaveClass(
      "w-full",
      "justify-start",
      "pr-8",
      "text-left",
    )
    expect(screen.getByText(longTitle)).toHaveClass(
      "min-w-0",
      "flex-1",
      "truncate",
      "text-left",
    )
    expect(action).toHaveAttribute("data-sidebar", "menu-action")
  })

  it("opens layout tools independently from the thesis creation action", () => {
    const callbacks = renderNavigation()
    const thesisFolder = screen.getByRole("button", { name: "排版工具" })

    expect(screen.getByRole("button", { name: "新建毕业论文" })).toBeEnabled()
    expect(thesisFolder).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("button", { name: "新建毕业论文（暂未开放）" }),
    ).not.toBeInTheDocument()
    fireEvent.click(thesisFolder)
    expect(thesisFolder).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(screen.getByRole("button", { name: "三线表生成器" }))
    expect(callbacks.onSelectThesisTool).toHaveBeenCalledWith("three_line_table")
    fireEvent.click(screen.getByRole("button", { name: "表格生成器" }))
    expect(callbacks.onSelectThesisTool).toHaveBeenCalledWith("general_table")
    fireEvent.click(screen.getByRole("button", { name: "多图排版" }))
    expect(callbacks.onSelectThesisTool).toHaveBeenCalledWith("multi_figure")
    expect(callbacks.onCreateDocument).not.toHaveBeenCalled()
  })

  it("keeps standalone thesis tools available while document storage is unavailable", () => {
    const callbacks = renderNavigation({ disabled: true })

    fireEvent.click(screen.getByRole("button", { name: "排版工具" }))
    const tool = screen.getByRole("button", { name: "三线表生成器" })
    expect(tool).not.toBeDisabled()
    expect(screen.getByRole("button", { name: "开题报告第一版" })).toBeDisabled()

    fireEvent.click(tool)
    expect(callbacks.onSelectThesisTool).toHaveBeenCalledWith("three_line_table")
  })

  it("creates an independent file from blank or existing content", async () => {
    const callbacks = renderNavigation()
    fireEvent.click(screen.getByRole("button", { name: "新建开题报告" }))
    expect(screen.getByRole("dialog", { name: "新建开题报告" })).toBeInTheDocument()
    expect(screen.getByLabelText("文件名")).toHaveValue("合成学生甲-开题报告")

    fireEvent.change(screen.getByLabelText("文件名"), {
      target: { value: "开题报告第二版" },
    })
    fireEvent.click(screen.getByRole("combobox", { name: "初始内容" }))
    fireEvent.click(await screen.findByRole("option", { name: "基于：开题报告第一版" }))
    fireEvent.click(screen.getByRole("button", { name: "新建", hidden: true }))

    await waitFor(() =>
      expect(callbacks.onCreateDocument).toHaveBeenCalledWith({
        type: "proposal",
        title: "开题报告第二版",
        sourceDocumentId: "proposal-a",
      }),
    )
  })

  it("requires confirmation before recycling a document", async () => {
    const callbacks = renderNavigation()
    fireEvent.click(screen.getByRole("button", { name: "管理文档 开题报告第一版" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "移到回收站" }))

    const dialog = screen.getByRole("dialog", { name: "移到回收站？" })
    expect(dialog).toHaveTextContent("已经导出的文件不会被删除")
    fireEvent.click(screen.getByRole("button", { name: "移到回收站" }))
    await waitFor(() =>
      expect(callbacks.onDeleteDocument).toHaveBeenCalledWith("proposal-a"),
    )
  })

  it("renames a file without changing its document content", async () => {
    const callbacks = renderNavigation()
    fireEvent.click(screen.getByRole("button", { name: "管理文档 开题报告第一版" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名" }))
    fireEvent.change(screen.getByRole("textbox", { name: "新文件名" }), {
      target: { value: "开题报告定稿" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(callbacks.onRenameDocument).toHaveBeenCalledWith(
        "proposal-a",
        "开题报告定稿",
      ),
    )
  })

  it("restores or permanently deletes only from the recycle bin", async () => {
    const recycled = documentRecord("proposal-old", "开题报告旧版")
    recycled.soft_deleted_at = "2026-09-01T01:00:00Z"
    const callbacks = renderNavigation({ deletedDocuments: [recycled] })

    fireEvent.click(screen.getByRole("button", { name: "回收站（1 个文档）" }))
    fireEvent.click(screen.getByRole("button", { name: "管理回收站文档 开题报告旧版" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "恢复" }))
    await waitFor(() =>
      expect(callbacks.onRestoreDocument).toHaveBeenCalledWith("proposal-old"),
    )

    fireEvent.click(screen.getByRole("button", { name: "管理回收站文档 开题报告旧版" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "永久删除" }))
    const dialog = screen.getByRole("dialog", { name: "永久删除文档？" })
    expect(dialog).toHaveTextContent("且无法恢复")
    expect(dialog).toHaveTextContent("已经导出的文件不会被删除")
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }))
    await waitFor(() =>
      expect(callbacks.onPurgeDocument).toHaveBeenCalledWith("proposal-old"),
    )
  })
})
