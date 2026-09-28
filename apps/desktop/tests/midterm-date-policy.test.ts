import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { MidtermDatePolicyService, parseAndVerifyMidtermDatePolicy } from "../electron/midterm-date-policy"
import { canonicalJson } from "../electron/update-service"

const directories: string[] = []
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString()

function signedPolicy(rules: Array<{ college: string; start_date: string; end_date: string }>) {
  const payload = { schema_version: "1.0", published_at: "2026-09-24T00:00:00.000Z", rules }
  return {
    payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64"),
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("signed midterm date policy", () => {
  it("accepts inclusive college-specific ranges and rejects invalid or tampered rules", () => {
    const policy = signedPolicy([{ college: "新材料与新能源学院", start_date: "2026-09-20", end_date: "2026-09-30" }])
    expect(parseAndVerifyMidtermDatePolicy(policy, publicKeyPem)).toEqual([{
      college: "新材料与新能源学院", startDate: "2026-09-20", endDate: "2026-09-30",
    }])
    expect(() => parseAndVerifyMidtermDatePolicy({ ...policy, payload: { ...policy.payload, rules: [] } }, publicKeyPem)).toThrow("signature")
    expect(() => parseAndVerifyMidtermDatePolicy(signedPolicy([
      { college: "学院", start_date: "2026-09-31", end_date: "2026-10-01" },
    ]), publicKeyPem)).toThrow("rule")
    expect(() => parseAndVerifyMidtermDatePolicy(signedPolicy([
      { college: "学院", start_date: "2026-10-01", end_date: "2026-09-30" },
    ]), publicKeyPem)).toThrow("rule")
    expect(() => parseAndVerifyMidtermDatePolicy(signedPolicy([
      { college: "学院", start_date: "2026-09-20", end_date: "2026-09-30" },
      { college: "学院", start_date: "2026-09-20", end_date: "2026-09-30" },
    ]), publicKeyPem)).toThrow("duplicate")
  })

  it("keeps a verified cached policy when the network later fails", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "sztu-midterm-policy-"))
    directories.push(userDataPath)
    const policy = signedPolicy([{ college: "学院", start_date: "2026-09-20", end_date: "2026-09-30" }])
    const service = new MidtermDatePolicyService({
      userDataPath, policyUrl: "https://example.test/date-policy.json", publicKeyPem,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(policy), { status: 200 })),
    })
    expect((await service.checkNow()).state).toBe("ready")
    const offline = new MidtermDatePolicyService({
      userDataPath, policyUrl: "https://example.test/date-policy.json", publicKeyPem,
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
    })
    await offline.initialize()
    expect(offline.getStatus().rules).toHaveLength(1)
    expect((await offline.checkNow()).rules).toHaveLength(1)
  })
})
