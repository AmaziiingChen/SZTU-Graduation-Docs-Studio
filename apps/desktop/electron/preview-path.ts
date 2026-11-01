import { realpath } from "node:fs/promises"
import path from "node:path"

/** Resolve the entire cache path: Windows may redirect only a child directory. */
export async function privatePreviewRoot(
  userDataPath: string,
  documentId: string,
  previewId: string,
): Promise<string> {
  return realpath(path.resolve(userDataPath, "previews", documentId, previewId))
}
