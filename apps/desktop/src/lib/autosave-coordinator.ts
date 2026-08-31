export type AutosaveScope = "profile" | "document"

type AutosavePartVersion = Readonly<{
  edited: number
  persisted: number
  persistedFingerprint: string | null
}>

export type AutosaveVersionState = Readonly<
  Record<AutosaveScope, AutosavePartVersion>
>

export type AutosavePlan = Readonly<Record<AutosaveScope, number | null>>

export type AutosaveFingerprints = Readonly<Record<AutosaveScope, string>>

export function autosaveFingerprint(value: unknown): string {
  return JSON.stringify(value)
}

export function createAutosaveVersionState(options?: {
  profileDirty?: boolean
  documentDirty?: boolean
  profileFingerprint?: string
  documentFingerprint?: string
}): AutosaveVersionState {
  return {
    profile: {
      edited: options?.profileDirty ? 1 : 0,
      persisted: 0,
      persistedFingerprint: options?.profileFingerprint ?? null,
    },
    document: {
      edited: options?.documentDirty ? 1 : 0,
      persisted: 0,
      persistedFingerprint: options?.documentFingerprint ?? null,
    },
  }
}

export function markAutosaveEdited(
  state: AutosaveVersionState,
  scope: AutosaveScope,
): AutosaveVersionState {
  return {
    ...state,
    [scope]: {
      ...state[scope],
      edited: state[scope].edited + 1,
    },
  }
}

export function planAutosave(state: AutosaveVersionState): AutosavePlan {
  return {
    profile:
      state.profile.edited === state.profile.persisted
        ? null
        : state.profile.edited,
    document:
      state.document.edited === state.document.persisted
        ? null
        : state.document.edited,
  }
}

export function reconcileAutosaveFingerprints(
  state: AutosaveVersionState,
  fingerprints: AutosaveFingerprints,
): AutosaveVersionState {
  let next = state
  for (const scope of ["profile", "document"] as const) {
    const part = next[scope]
    if (
      part.edited === part.persisted ||
      part.persistedFingerprint === null ||
      part.persistedFingerprint !== fingerprints[scope]
    ) {
      continue
    }
    next = {
      ...next,
      [scope]: {
        ...part,
        persisted: part.edited,
      },
    }
  }
  return next
}

export function acknowledgeAutosave(
  state: AutosaveVersionState,
  scope: AutosaveScope,
  persistedVersion: number,
  persistedFingerprint?: string,
): AutosaveVersionState {
  const part = state[scope]
  if (
    !Number.isInteger(persistedVersion) ||
    persistedVersion < part.persisted ||
    persistedVersion > part.edited
  ) {
    throw new RangeError(`Invalid ${scope} autosave acknowledgement.`)
  }
  return {
    ...state,
    [scope]: {
      ...part,
      persisted: persistedVersion,
      persistedFingerprint:
        persistedFingerprint ?? part.persistedFingerprint,
    },
  }
}
