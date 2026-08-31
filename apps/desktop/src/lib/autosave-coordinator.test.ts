import { describe, expect, it } from "vitest"

import {
  acknowledgeAutosave,
  autosaveFingerprint,
  createAutosaveVersionState,
  markAutosaveEdited,
  planAutosave,
  reconcileAutosaveFingerprints,
} from "@/lib/autosave-coordinator"

describe("autosave coordinator", () => {
  it("keeps clean profile and document data out of the save plan", () => {
    expect(planAutosave(createAutosaveVersionState())).toEqual({
      profile: null,
      document: null,
    })
  })

  it("plans only the scope that changed", () => {
    const documentOnly = markAutosaveEdited(
      createAutosaveVersionState(),
      "document",
    )
    expect(planAutosave(documentOnly)).toEqual({
      profile: null,
      document: 1,
    })

    const profileOnly = markAutosaveEdited(
      createAutosaveVersionState(),
      "profile",
    )
    expect(planAutosave(profileOnly)).toEqual({
      profile: 1,
      document: null,
    })
  })

  it("retries only the unacknowledged part of a mixed save", () => {
    let state = createAutosaveVersionState()
    state = markAutosaveEdited(state, "profile")
    state = markAutosaveEdited(state, "document")
    const firstPlan = planAutosave(state)
    expect(firstPlan).toEqual({ profile: 1, document: 1 })

    state = acknowledgeAutosave(state, "profile", firstPlan.profile ?? 0)
    expect(planAutosave(state)).toEqual({ profile: null, document: 1 })

    state = acknowledgeAutosave(state, "document", firstPlan.document ?? 0)
    expect(planAutosave(state)).toEqual({ profile: null, document: null })
  })

  it("does not lose an edit made while an earlier save is in flight", () => {
    let state = markAutosaveEdited(
      createAutosaveVersionState(),
      "document",
    )
    const inFlightVersion = planAutosave(state).document
    state = markAutosaveEdited(state, "document")
    state = acknowledgeAutosave(state, "document", inFlightVersion ?? 0)

    expect(planAutosave(state)).toEqual({ profile: null, document: 2 })
  })

  it("rejects acknowledgements outside the edited version range", () => {
    const state = createAutosaveVersionState()
    expect(() => acknowledgeAutosave(state, "profile", 1)).toThrow(
      "Invalid profile autosave acknowledgement.",
    )
  })

  it("skips a write when editing returns to the persisted content", () => {
    const original = autosaveFingerprint({ body: "原内容" })
    let state = createAutosaveVersionState({
      documentFingerprint: original,
    })
    state = markAutosaveEdited(state, "document")
    state = markAutosaveEdited(state, "document")
    state = reconcileAutosaveFingerprints(state, {
      profile: autosaveFingerprint({}),
      document: original,
    })

    expect(planAutosave(state)).toEqual({ profile: null, document: null })
  })

  it("records the fingerprint only after the matching write succeeds", () => {
    const original = autosaveFingerprint({ body: "原内容" })
    const changed = autosaveFingerprint({ body: "新内容" })
    let state = createAutosaveVersionState({
      documentFingerprint: original,
    })
    state = markAutosaveEdited(state, "document")
    const version = planAutosave(state).document
    state = acknowledgeAutosave(state, "document", version ?? 0, changed)
    state = markAutosaveEdited(state, "document")
    state = reconcileAutosaveFingerprints(state, {
      profile: autosaveFingerprint({}),
      document: changed,
    })

    expect(planAutosave(state)).toEqual({ profile: null, document: null })
  })
})
