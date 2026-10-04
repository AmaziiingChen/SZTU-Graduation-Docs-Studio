import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DocumentDateField } from "@/components/workbench/document-date-field"

afterEach(cleanup)

function DateForm({ initialDate }: { initialDate: string }) {
  const [value, setValue] = useState(initialDate)
  return <DocumentDateField id="review-date" label="日期" value={value} onChange={setValue} placeholder="选择日期" />
}

describe("DocumentDateField optional date", () => {
  it("lets the user return a selected date to an empty field", async () => {
    render(<DateForm initialDate="2026-10-15" />)
    fireEvent.click(screen.getByRole("button", { name: "日期", exact: true }))
    fireEvent.click(await screen.findByRole("button", { name: "清空日期" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "日期", exact: true })).toHaveTextContent("选择日期"))
    expect(screen.queryByRole("button", { name: "清空日期" })).not.toBeInTheDocument()
  })

  it("also clears a stored value that cannot be parsed as a date", async () => {
    render(<DateForm initialDate="2026-02-30" />)
    fireEvent.click(screen.getByRole("button", { name: "日期", exact: true }))
    fireEvent.click(await screen.findByRole("button", { name: "清空日期" }))
    fireEvent.click(screen.getByRole("button", { name: "日期", exact: true }))
    expect(await screen.findByRole("button", { name: "清空日期" })).toBeDisabled()
  })
})
