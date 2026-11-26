const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MOBILE_PATTERN = /^1[3-9]\d{9}$/

/** 去掉电话号码里常见的分隔符，便于接受 138-0000-0000 这类写法。 */
export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s\-()]/g, "").replace(/^\+?86/, "")
}

export function isEmailContact(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

export function isPhoneContact(value: string): boolean {
  return MOBILE_PATTERN.test(normalizePhone(value))
}

/** 反馈联系方式只接受邮箱或中国大陆手机号。 */
export function isValidContact(value: string): boolean {
  return isEmailContact(value) || isPhoneContact(value)
}
