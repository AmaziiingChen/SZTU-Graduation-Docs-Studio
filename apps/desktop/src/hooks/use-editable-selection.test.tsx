import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useEditableSelection } from "./use-editable-selection"

function Fixture() {
  useEditableSelection()
  return <><button>工具</button><input /><textarea /><div contentEditable suppressContentEditableWarning><p>正文</p><span contentEditable={false}>工具标签</span></div></>
}
afterEach(cleanup)
describe("editable selection", () => {
  it.each(["metaKey", "ctrlKey"])("limits %s+A to editing surfaces", (modifier) => {
    const { container } = render(<Fixture />)
    const selectAll = (selector: string) => fireEvent.keyDown(container.querySelector(selector)!, { key: "a", [modifier]: true })
    expect(selectAll("button")).toBe(false)
    expect(selectAll("input")).toBe(true)
    expect(selectAll("textarea")).toBe(true)
    expect(selectAll("p")).toBe(true)
    expect(selectAll("span")).toBe(false)
  })
  it("does not intercept ordinary typing and removes its listener on unmount", () => {
    const { unmount } = render(<Fixture />)
    expect(fireEvent.keyDown(document.body, { key: "a" })).toBe(true)
    unmount()
    expect(fireEvent.keyDown(document.body, { key: "a", metaKey: true })).toBe(true)
  })
})
