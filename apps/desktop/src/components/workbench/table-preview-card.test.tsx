import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TablePreviewCard } from "@/components/workbench/table-preview-card"
import { copyTablePreviewPng, downloadTablePreviewPng } from "@/lib/table-preview-image"

vi.mock("@/lib/table-preview-image", () => ({
  copyTablePreviewPng: vi.fn().mockResolvedValue(undefined),
  downloadTablePreviewPng: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("TablePreviewCard", () => {
  it("copies the current preview as a PNG", async () => {
    render(
      <TablePreviewCard
        rows={[["指标", "数值"], ["准确率", "92.4"]]}
        caption="实验结果"
        headerRows={1}
        variant="three-line"
        tableLabel="三线表预览"
        description="预览说明"
        emptyText="暂无数据"
        latex={"\\begin{tabular}"}
        filename="table.tex"
        pngFilename="table.png"
        packages={["booktabs"]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "复制 PNG" }))

    await waitFor(() => expect(copyTablePreviewPng).toHaveBeenCalledWith({
      rows: [["指标", "数值"], ["准确率", "92.4"]],
      caption: "实验结果",
      headerRows: 1,
      alignments: [],
      style: "three-line",
    }))
  })

  it("downloads the preview when image clipboard access is unavailable", async () => {
    render(
      <TablePreviewCard
        rows={[["指标", "数值"], ["准确率", "92.4"]]}
        caption=""
        headerRows={1}
        variant="grid"
        tableLabel="普通表格预览"
        emptyText="暂无数据"
        latex={"\\begin{tabular}"}
        filename="table.tex"
        pngFilename="table.png"
        packages={[]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }))

    await waitFor(() => expect(downloadTablePreviewPng).toHaveBeenCalledWith(
      expect.objectContaining({ style: "grid" }),
      "table.png",
    ))
  })

  it("keeps the source out of the main flow until requested", () => {
    render(
      <TablePreviewCard
        rows={[["指标", "数值"], ["准确率", "92.4"]]}
        caption=""
        headerRows={1}
        variant="grid"
        tableLabel="普通表格预览"
        description="预览说明"
        emptyText="暂无数据"
        latex={"\\begin{tabular}"}
        filename="table.tex"
        pngFilename="table.png"
        packages={[]}
      />,
    )

    expect(screen.queryByLabelText("生成的 LaTeX 源码")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "复制源码" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "下载源码" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    expect(screen.getByLabelText("生成的 LaTeX 源码")).toHaveValue("\\begin{tabular}")
  })
})
