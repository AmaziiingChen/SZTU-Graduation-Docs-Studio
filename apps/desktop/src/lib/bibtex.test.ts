import { describe, expect, it } from "vitest"

import {
  bibtexTitleRuns,
  decodeBibtexText,
  formatBibtex,
  parseBibtex,
} from "./bibtex"

describe("BibTeX reference import", () => {
  it("parses multiple common entries with nested braces and quoted values", () => {
    const source = `
@article{zhang2025,
  author = {张三 and 李四 and 王五 and 赵六},
  title = {{H}_{2} 储能系统研究},
  journal = "深圳技术大学学报",
  year = {2025},
  volume = {3},
  number = {2},
  pages = {10--18},
  doi = {10.1000/synthetic}
}

@phdthesis{smith2024,
  author = {Smith, Alex},
  title = {A {Robust} Method},
  school = {Synthetic University},
  address = {Shenzhen},
  year = 2024
}`
    const parsed = parseBibtex(source)

    expect(parsed.issues).toEqual([])
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0].fields.title).toBe("{H}_{2} 储能系统研究")

    const formatted = formatBibtex(source).references
    expect(formatted[0].text).toContain(
      "[1] 张三，李四，王五，等． H_2 储能系统研究[J]．深圳技术大学学报，2025，3（2）：10-18．",
    )
    expect(formatted[0].text).toContain("DOI: 10.1000/synthetic．")
    expect(formatted[0].paragraph.runs[0].text).toMatch(/H$/)
    expect(formatted[0].paragraph.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "2", script: "sub" }),
      ]),
    )
    expect(formatted[1].text).toContain(
      "[2] Smith A. A Robust Method[D]. Shenzhen: Synthetic University, 2024.",
    )
  })

  it("resolves case-insensitive string macros, forward references, concatenated values, and parenthesized entries", () => {
    const parsed = parseBibtex(`
% 导出的说明
@string{journalName = journalPrefix # "学报"}
@string{journalPrefix = "深圳技术大学"}
@book(book1,
  editor = {Chen, Ming},
  title = "本地" # {文档工具},
  publisher = JOURNALNAME,
  address = {深圳},
  year = {2026},
)
`)
    expect(parsed.issues).toEqual([])
    expect(parsed.entries).toMatchObject([
      {
        type: "book",
        citationKey: "book1",
        fields: {
          title: "本地文档工具",
          publisher: "深圳技术大学学报",
        },
      },
    ])
  })

  it("reports undefined and circular string macros on the affected field", () => {
    const undefinedResult = parseBibtex(`
@article{missingMacro,
  author={张三}, title={未定义宏}, journal=missingJournal, year={2026}
}`)
    expect(undefinedResult.issues).toContainEqual(
      expect.objectContaining({
        code: "undefined_macro",
        citationKey: "missingMacro",
        field: "journal",
      }),
    )

    const cycleResult = parseBibtex(`
@string{journalA = journalB}
@string{journalB = JOURNALA}
@article{macroCycle,
  author={张三}, title={循环宏}, journal=journalA, year={2026}
}`)
    expect(cycleResult.issues).toContainEqual(
      expect.objectContaining({
        code: "macro_cycle",
        citationKey: "macroCycle",
        field: "journal",
      }),
    )
    expect(
      cycleResult.issues.find((item) => item.code === "macro_cycle")?.message,
    ).toContain("journala -> journalb -> journala")
  })

  it("returns actionable issues without discarding valid neighboring entries", () => {
    const result = parseBibtex(`
@article{valid,
  author={合成作者}, title={有效条目}, journal={合成期刊}, year={2026}
}
@article{broken,
  author={缺少年份}, title={无效条目}, journal={合成期刊}
}
@unknown{other, title={未知类型}}
`)
    expect(result.entries).toHaveLength(3)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_field",
          citationKey: "broken",
          field: "year",
        }),
        expect.objectContaining({
          code: "unsupported_type",
          citationKey: "other",
        }),
      ]),
    )
  })

  it("reports duplicate keys and malformed source deterministically", () => {
    const result = parseBibtex(`
@misc{same, title={第一条}}
@misc{same, title={第二条}}
不是 BibTeX
`)
    expect(result.entries).toHaveLength(1)
    expect(result.issues.map((item) => item.code)).toEqual([
      "duplicate_key",
      "syntax",
    ])
  })

  it("decodes a conservative allowlist of common LaTeX text escapes", () => {
    expect(decodeBibtexText('{M\\"uller} \\& {CO}_{2}')).toBe(
      "Müller & CO_2",
    )
  })

  it("uses the same conservative TeX command semantics for plain and rich text", () => {
    const value = String.raw`{\mathrm{CO}}_{2} 与 \operatorname{R}^{2}`
    const runs = bibtexTitleRuns(value)

    expect(decodeBibtexText(value)).toBe("CO_2 与 R^2")
    expect(runs.map((run) => run.text).join("")).toBe("CO2 与 R2")
    expect(runs).toEqual([
      { text: "CO" },
      { text: "2", script: "sub" },
      { text: " 与 R" },
      { text: "2", script: "super" },
    ])
  })

  it("reports unsupported TeX commands while keeping plain and rich fallback text aligned", () => {
    const source = String.raw`
@article{unsupportedTex,
  author={张三},
  title={A \unknowncommand{模型}},
  journal={合成期刊},
  year={2026}
}`
    const parsed = parseBibtex(source)
    const title = parsed.entries[0].fields.title

    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported_command",
        citationKey: "unsupportedTex",
        field: "title",
      }),
    )
    expect(decodeBibtexText(title)).toBe("A 模型")
    expect(bibtexTitleRuns(title).map((run) => run.text).join("")).toBe(
      "A 模型",
    )
  })

  it("does not block source-only metadata containing unsupported TeX commands", () => {
    const result = formatBibtex(String.raw`
@article{metadataOnly,
  author={合成作者},
  title={微通道散热研究},
  journal={合成期刊},
  year={2026},
  abstract={深度为 130 {$\mu$}m，温度为 46.96\textcelsius，来源还包含 \sourceonly{说明}},
  file={/private/fixture/reference.pdf},
  keywords={\sourceonly{热管理}}
}`)

    expect(result.issues).toEqual([])
    expect(result.references[0].text).toBe(
      "[1] 合成作者． 微通道散热研究[J]．合成期刊，2026．",
    )
    expect(result.references[0].text).not.toContain("abstract")
    expect(result.entries[0].fields.abstract).toContain("\\sourceonly")
  })

  it("decodes common scientific temperature and micro symbols", () => {
    const value = String.raw`46.96\textcelsius 与 130 {$\mu$}m`

    expect(decodeBibtexText(value)).toBe("46.96℃ 与 130 μm")
    expect(parseBibtex(String.raw`
@article{scientificSymbols,
  author={合成作者},
  title={46.96\textcelsius 与 130 {$\mu$}m 条件下的研究},
  journal={合成期刊},
  year={2026}
}`).issues).toEqual([])
  })

  it("accepts a CNKI-style article with a journal macro and common math roman text", () => {
    const result = formatBibtex(String.raw`
@string{CNKIJournal = "计算机工程与应用"}
@article{CNKI:SUN:JSGG.0.2025-01-001,
  author = {张三 and 李四},
  title = {{\mathrm{CO}}_{2} 排放预测方法研究},
  journal = cnkijournal,
  year = {2025},
  volume = {61},
  number = {1},
  pages = {1--8},
  doi = {10.3778/j.issn.1002-8331.2401-0001}
}`)

    expect(result.issues).toEqual([])
    expect(result.entries[0].fields.journal).toBe("计算机工程与应用")
    expect(result.references[0].text).toContain(
      "CO_2 排放预测方法研究[J]．计算机工程与应用，2025，61（1）：1-8．",
    )
    expect(result.references[0].text).not.toContain("\\mathrm")
    expect(result.references[0].paragraph.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "2", script: "sub" }),
      ]),
    )
  })

  it("strips trailing sentence punctuation that exporters leave inside fields", () => {
    const latin = formatBibtex(String.raw`
@article{dots, author={Smith, John T. and Doe, Jane and Roe, Richard and Poe, Ed},
  title={Trailing period title.}, journal={Journal of Dots.}, year={2020.},
  volume={1.}, number={2.}, pages={3--4.}, doi={10.1000/abc.}}`)

    expect(latin.references[0].text).toBe(
      "[1] Smith J. T., Doe J., Roe R., et al. Trailing period title[J]. Journal of Dots, 2020, 1(2): 3-4. DOI: 10.1000/abc.",
    )

    const chinese = formatBibtex(String.raw`
@article{cn, author={张三}, title={带句号的题名。}, journal={合成期刊。}, year={2020}}`)

    expect(chinese.references[0].text).toBe(
      "[1] 张三． 带句号的题名[J]．合成期刊，2020．",
    )

    const online = formatBibtex(String.raw`
@online{web, author={张三}, title={资料}, year={2020}, url={https://example.com/a.}}`)

    expect(online.references[0].text).toBe(
      "[1] 张三． 资料[EB/OL]．（2020）． https://example.com/a．",
    )
  })

  it("preserves bold, italic, subscript, and superscript title semantics", () => {
    const runs = bibtexTitleRuns(
      String.raw`{\textbf{CO}}_{2} 与 \emph{R}^{2} \textit{模型}`,
    )

    expect(runs).toEqual([
      { text: "CO", bold: true },
      { text: "2", script: "sub" },
      { text: " 与 " },
      { text: "R", italic: true },
      { text: "2", script: "super" },
      { text: " " },
      { text: "模型", italic: true },
    ])
  })

  it("formats books, book chapters, proceedings, and standards without collapsing their carrier types", () => {
    const result = formatBibtex(`
@book{book2026,
  author={张三}, translator={李四}, title={结构化文档工程}, edition={2},
  address={北京}, publisher={测试出版社}, year={2026}, pages={10--20}
}
@incollection{chapter2025,
  author={王五}, title={连续表格分页}, booktitle={文档自动化手册}, edition={3},
  address={上海}, publisher={合成出版社}, year={2025}, pages={30--45}
}
@inproceedings{paper2026,
  author={赵六}, title={本地排版研究}, booktitle={文档工程会议论文集},
  address={深圳}, publisher={测试学会}, year={2026}, pages={50--60}
}
@proceedings{proceedings2026,
  editor={陈七}, title={文档工程会议论文集}, address={深圳},
  publisher={测试学会}, year={2026}
}
@standard{standard2025,
  title={信息与文献 参考文献著录规则}, number={GB/T 7714-2025},
  organization={国家标准委}, year={2025}
}`)

    expect(result.issues).toEqual([])
    expect(result.references.map((item) => item.text)).toEqual([
      "[1] 张三． 结构化文档工程[M]．李四，译． 2版． 北京：测试出版社，2026，10-20．",
      "[2] 王五． 连续表格分页[M]//文档自动化手册．3版． 上海：合成出版社，2025，30-45．",
      "[3] 赵六． 本地排版研究[C]//文档工程会议论文集．深圳：测试学会，2026，50-60．",
      "[4] 陈七，编． 文档工程会议论文集[C]．深圳：测试学会，2026．",
      "[5] GB/T 7714-2025 信息与文献 参考文献著录规则[S]．国家标准委，2025．",
    ])
  })

  it("distinguishes online aliases from non-network misc entries", () => {
    const source = `
@online{site2026,
  author={测试作者}, title={本地文档指南}, date={2026-08-01},
  url={https://example.invalid/guide}, urldate={2026-09-02}
}
@electronic{archive2025,
  title={电子资料}, year={2025}, url={https://example.invalid/archive}
}
@www{website2024,
  title={网站资料}, year={2024}, url={https://example.invalid/site}
}
@misc{networkMisc,
  title={带网址的其他资料}, year={2023}, url={https://example.invalid/misc}
}
@misc{plainMisc, title={未分类内部资料}, year={2022}}
`
    const result = formatBibtex(source)

    expect(result.issues).toEqual([])
    expect(result.references.map((item) => item.text)).toEqual([
      "[1] 测试作者． 本地文档指南[EB/OL]．（2026-08-01）[2026-09-02]． https://example.invalid/guide．",
      "[2] 电子资料[EB/OL]．（2025）． https://example.invalid/archive．",
      "[3] 网站资料[EB/OL]．（2024）． https://example.invalid/site．",
      "[4] 带网址的其他资料[EB/OL]．（2023）． https://example.invalid/misc．",
      "[5] 未分类内部资料[Z]．2022．",
    ])
  })

  it("embeds rich title runs into the complete generated reference paragraph", () => {
    const [reference] = formatBibtex(String.raw`
@article{rich,
  author={张三},
  title={{\textbf{CO}}_{2} 与 \emph{R}^{2} 模型},
  journal={合成期刊},
  year={2026}
}`).references

    expect(reference.paragraph).toEqual({
      type: "paragraph",
      runs: [
        { text: "[1] 张三． " },
        { text: "CO", bold: true },
        { text: "2", script: "sub" },
        { text: " 与 " },
        { text: "R", italic: true },
        { text: "2", script: "super" },
        { text: " 模型[J]．合成期刊，2026．" },
      ],
    })
  })
})
