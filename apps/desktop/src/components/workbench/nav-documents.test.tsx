import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
  documents = [documentRecord("proposal-a", "开题报告第一版")],
  deletedDocuments = [],
}: {
  documents?: DocumentRecord[]
  deletedDocuments?: DocumentRecord[]
} = {}) {
  const callbacks = {
    onSelectDocument: vi.fn().mockResolvedValue(undefined),
    onCreateDocument: vi.fn().mockResolvedValue(undefined),
    onRenameDocument: vi.fn().mockResolvedValue(undefined),
    onDeleteDocument: vi.fn().mockResolvedValue(undefined),
    onRestoreDocument: vi.fn().mockResolvedValue(undefined),
    onPurgeDocument: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <NavDocuments
              profileActive={false}
              inspectionActive={false}
              activeDocumentId={documents[0]?.id ?? null}
              documents={documents}
              deletedDocuments={deletedDocuments}
              disabled={false}
              {...callbacks}
            />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </TooltipProvider>,
  )
  return callbacks
}

describe("NavDocuments file tree", () => {
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
    expect(fileButton.querySelector("span")).toHaveClass(
      "min-w-0",
      "flex-1",
      "truncate",
      "text-left",
    )
    expect(action).toHaveClass("right-1")
  })

  it("expands the thesis folder without exposing a creation action", () => {
    const callbacks = renderNavigation()
    const thesisFolder = screen.getByRole("button", { name: "毕业论文" })

    expect(thesisFolder).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("button", { name: "新建毕业论文（暂未开放）" }),
    ).not.toBeInTheDocument()
    fireEvent.click(thesisFolder)
    expect(thesisFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByLabelText("毕业论文暂无文档")).toHaveTextContent("暂无文档")
    expect(callbacks.onCreateDocument).not.toHaveBeenCalled()
  })

  it("creates an independent file from blank or existing content", async () => {
    const callbacks = renderNavigation()
    fireEvent.click(screen.getByRole("button", { name: "新建开题报告" }))
    expect(screen.getByRole("dialog", { name: "新建开题报告" })).toBeInTheDocument()

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
