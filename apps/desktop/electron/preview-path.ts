import { realpath } from "node:fs/promises"
import path from "node:path"

/** Match the sidecar's canonical cache path even when macOS aliases /tmp to /private/tmp. */
export async function privatePreviewRoot(
  userDataPath: string,
  documentId: string,
  previewId: string,
): Promise<string> {
  const canonicalUserData = await realpath(userDataPath)
  return path.resolve(canonicalUserData, "previews", documentId, previewId)
}
