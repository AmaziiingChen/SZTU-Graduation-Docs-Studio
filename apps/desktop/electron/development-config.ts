import path from "node:path"

/** Explicit local-only overrides for concurrent worktrees; packaged builds ignore them. */
export function developmentConfig(packaged: boolean, env: NodeJS.ProcessEnv = process.env) {
  const port = packaged ? "5173" : env.SZTU_DOCS_DEV_PORT ?? "5173"
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error("SZTU_DOCS_DEV_PORT must be a local port from 1024 to 65535")
  }
  const dataDirectory = packaged ? undefined : env.SZTU_DOCS_DEV_DATA_DIR
  if (dataDirectory !== undefined && !path.isAbsolute(dataDirectory)) {
    throw new Error("SZTU_DOCS_DEV_DATA_DIR must be an absolute path")
  }
  return { url: `http://127.0.0.1:${Number(port)}`, dataDirectory }
}
