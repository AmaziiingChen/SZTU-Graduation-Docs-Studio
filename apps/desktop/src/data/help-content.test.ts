import { describe, expect, it } from "vitest"

import {
  helpArticles,
  helpCategories,
  keyboardShortcuts,
  releaseNotes,
  searchHelp,
} from "./help-content"

describe("help content", () => {
  it("assigns every article to a known category", () => {
    const categoryIds = new Set(helpCategories.map((category) => category.id))
    for (const article of helpArticles) {
      expect(categoryIds.has(article.category)).toBe(true)
      expect(article.title.length).toBeGreaterThan(0)
      expect(article.body.length).toBeGreaterThan(0)
    }
    for (const category of helpCategories) {
      expect(helpArticles.some((article) => article.category === category.id)).toBe(true)
    }
  })

  it("finds the bibliography article from field keywords", () => {
    const hits = searchHelp("文献 空值")
    expect(hits.map((hit) => hit.article.id)).toContain("references-bibtex")
    expect(hits[0]?.snippet).toBeTruthy()
  })

  it("returns every article for an empty query", () => {
    expect(searchHelp("   ")).toHaveLength(helpArticles.length)
  })

  it("ships shortcut and release metadata", () => {
    expect(keyboardShortcuts.length).toBeGreaterThan(0)
    expect(releaseNotes[0]?.version).toBe("0.2.0")
  })
})
