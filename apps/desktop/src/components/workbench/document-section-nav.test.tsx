import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DocumentSectionNav,
  type DocumentSectionOption,
} from "@/components/workbench/document-section-nav"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderNavigation(sections: DocumentSectionOption[]) {
  return render(
    <TooltipProvider>
      <DocumentSectionNav
        sections={sections}
        activeSection="research"
        animationContextKey="document-a"
        onSectionChange={() => undefined}
      />
    </TooltipProvider>,
  )
}

describe("DocumentSectionNav status marks", () => {
  afterEach(() => vi.useRealTimers())

  it("keeps incomplete status visually empty while preserving its accessible name", () => {
    const { container } = renderNavigation([
      {
        id: "research",
        label: "研究内容",
        description: "研究对象与主要问题",
        state: "incomplete",
      },
    ])

    expect(
      screen.getByRole("button", { name: "研究内容未完成" }),
    ).toBeEnabled()
    expect(container.querySelector('[data-slot="badge"]')).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="section-completion-mark"]'),
    ).not.toBeInTheDocument()
  })

  it("shows an optional empty section as valid and announces that it can be left blank", () => {
    const { container } = renderNavigation([
      {
        id: "research",
        label: "所需资料",
        description: "需收集的资料，可留空",
        state: "optional",
      },
    ])

    expect(
      screen.getByRole("button", { name: "所需资料可留空" }),
    ).toBeEnabled()
    expect(
      container.querySelector('[data-slot="section-completion-mark"]'),
    ).toHaveAttribute("data-animate", "false")
    expect(
      container.querySelector('[data-slot="section-error-mark"]'),
    ).not.toBeInTheDocument()
  })

  it("draws the check only when the same section changes to complete", () => {
    vi.useFakeTimers()
    const incomplete: DocumentSectionOption[] = [
      {
        id: "research",
        label: "研究内容",
        description: "研究对象与主要问题",
        state: "incomplete",
      },
    ]
    const { container, rerender } = renderNavigation(incomplete)

    rerender(
      <TooltipProvider>
        <DocumentSectionNav
          sections={[{ ...incomplete[0], state: "complete" }]}
          activeSection="research"
          animationContextKey="document-a"
          onSectionChange={() => undefined}
        />
      </TooltipProvider>,
    )

    const mark = container.querySelector('[data-slot="section-completion-mark"]')
    expect(mark).toHaveAttribute("data-animate", "true")
    expect(
      screen.getByRole("button", { name: "研究内容已填写" }),
    ).toBeEnabled()

    act(() => vi.advanceTimersByTime(420))
    expect(mark).toHaveAttribute("data-animate", "false")
  })

  it("shows an existing completion statically and shakes once when it becomes invalid", () => {
    vi.useFakeTimers()
    const { container, rerender } = renderNavigation([
      {
        id: "research",
        label: "研究内容",
        description: "研究对象与主要问题",
        state: "complete",
      },
    ])

    expect(
      container.querySelector('[data-slot="section-completion-mark"]'),
    ).toHaveAttribute("data-animate", "false")

    rerender(
      <TooltipProvider>
        <DocumentSectionNav
          sections={[
            {
              id: "research",
              label: "研究内容",
              description: "研究对象与主要问题",
              state: "error",
            },
          ]}
          activeSection="research"
          animationContextKey="document-a"
          onSectionChange={() => undefined}
        />
      </TooltipProvider>,
    )

    expect(
      screen.getByRole("button", { name: "研究内容需修改" }),
    ).toBeEnabled()
    const errorMark = container.querySelector('[data-slot="section-error-mark"]')
    expect(errorMark).toHaveClass("text-destructive")
    expect(errorMark).toHaveAttribute("data-animate", "true")

    act(() => vi.advanceTimersByTime(420))
    expect(errorMark).toHaveAttribute("data-animate", "false")
  })
})
