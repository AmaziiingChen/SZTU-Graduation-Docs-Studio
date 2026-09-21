import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { OutlineEditor } from "./outline-editor"
afterEach(cleanup)
it("previews import without changing existing items, then appends editable levels", () => {
  const onChange = vi.fn(), onStyle = vi.fn()
  render(<OutlineEditor value={[{id:"old",level:1,number:"1",title:"原目录"}]} numberingStyle="decimal_hierarchy" onChange={onChange} onNumberingStyleChange={onStyle} />)
  fireEvent.click(screen.getByRole("button", { name:"导入目录" }))
  fireEvent.change(screen.getByLabelText("目录文本"), {target:{value:"1 新章节\n1.1 子章节"}})
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name:"确认导入" }))
  expect(onStyle).toHaveBeenCalledWith("decimal_hierarchy")
  expect(onChange.mock.calls[0][0].map((x: {title:string;level:number}) => [x.title,x.level])).toEqual([["原目录",1],["新章节",1],["子章节",2]])
})
it("does not apply invalid input", () => {
  render(<OutlineEditor value={[]} numberingStyle="decimal_hierarchy" onChange={vi.fn()} onNumberingStyleChange={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name:"导入目录" }))
  fireEvent.change(screen.getByLabelText("目录文本"), {target:{value:"1.1 跳级"}})
  expect(screen.getByRole("button", { name:"确认导入" })).toBeDisabled()
})
