import { escapeLatex } from "@/lib/three-line-table"

export type FigureSourceItem = {
  filename: string
  caption?: string
}

export function validateFigureFilenames(images: FigureSourceItem[]): string[] {
  const errors: string[] = []
  const names = images.map((item) => item.filename.trim()).filter(Boolean)
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))]
  if (duplicates.length > 0) errors.push(`图片文件名不能重复：${duplicates.join("、")}。`)
  const unsafe = names.filter((name) => /[\\{}%#]/.test(name))
  if (unsafe.length > 0) {
    errors.push(`以下文件名包含 LaTeX 路径不支持的字符，请先重命名：${unsafe.join("、")}。`)
  }
  return errors
}

function joinPath(prefix: string, filename: string): string {
  const cleanPrefix = prefix.trim().replace(/[\\/]+$/g, "")
  const cleanFilename = filename.trim().replace(/^[\\/]+/g, "")
  return cleanPrefix ? `${cleanPrefix}/${cleanFilename}` : cleanFilename
}

function latexImagePath(value: string): string {
  return `\\detokenize{${value.replace(/[{}]/g, "")}}`
}

export function generateMultiFigureLatex({
  images,
  columns,
  caption,
  label,
  pathPrefix = "figures",
}: {
  images: FigureSourceItem[]
  columns: number
  caption?: string
  label?: string
  pathPrefix?: string
}): string {
  const validImages = images.filter((item) => item.filename.trim())
  if (validImages.length === 0 || validateFigureFilenames(validImages).length > 0) return ""

  const boundedColumns = Math.max(1, Math.min(4, Math.floor(columns)))
  const widthByColumns: Record<number, string> = {
    1: "0.96\\textwidth",
    2: "0.48\\textwidth",
    3: "0.31\\textwidth",
    4: "0.23\\textwidth",
  }
  const lines = ["\\begin{figure}[htbp]", "  \\centering"]

  if (validImages.length === 1) {
    const path = latexImagePath(joinPath(pathPrefix, validImages[0].filename))
    lines.push(`  \\includegraphics[width=${widthByColumns[1]}]{${path}}`)
  } else {
    validImages.forEach((image, index) => {
      const path = latexImagePath(joinPath(pathPrefix, image.filename))
      lines.push(
        `  \\begin{subfigure}[t]{${widthByColumns[boundedColumns]}}`,
        "    \\centering",
        `    \\includegraphics[width=\\linewidth]{${path}}`,
      )
      if (image.caption?.trim()) lines.push(`    \\caption{${escapeLatex(image.caption.trim())}}`)
      lines.push("  \\end{subfigure}%")
      const closesRow = (index + 1) % boundedColumns === 0 && index < validImages.length - 1
      if (closesRow) lines.push("  \\par\\medskip")
      else if (index < validImages.length - 1) lines.push("  \\hfill")
    })
  }

  if (caption?.trim()) lines.push(`  \\caption{${escapeLatex(caption.trim())}}`)
  if (label?.trim()) lines.push(`  \\label{${escapeLatex(label.trim())}}`)
  lines.push("\\end{figure}")
  return lines.join("\n")
}
