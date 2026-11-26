import { describe, expect, it } from "vitest"

import { isEmailContact, isPhoneContact, isValidContact } from "./contact-validation"

describe("contact validation", () => {
  it("accepts common email addresses", () => {
    expect(isEmailContact("student@example.com")).toBe(true)
    expect(isEmailContact("a.b+c@mail.sztu.edu.cn")).toBe(true)
    expect(isValidContact("a.b+c@mail.sztu.edu.cn")).toBe(true)
  })

  it("accepts mainland mobile numbers with optional prefixes and separators", () => {
    expect(isPhoneContact("13800138000")).toBe(true)
    expect(isPhoneContact("138-0013-8000")).toBe(true)
    expect(isPhoneContact("+86 138 0013 8000")).toBe(true)
    expect(isValidContact("+86 138 0013 8000")).toBe(true)
  })

  it("rejects malformed contacts", () => {
    for (const value of ["", "abc", "abc@", "@example.com", "abc@example", "12800138000", "1380013800", "10086"]) {
      expect(isValidContact(value)).toBe(false)
    }
  })
})
