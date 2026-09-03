import { readFile } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_TELEMETRY_ENDPOINT =
  "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events"
export const DEFAULT_DIAGNOSTIC_ENDPOINT =
  "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/diagnostics/v1/reports"

export type RemoteServicesConfig = {
  telemetryEndpoint?: string
  diagnosticEndpoint?: string
  updateManifestUrl?: string
  updatePublicKeyPem?: string
}

type RawRemoteServicesConfig = {
  telemetry_endpoint?: unknown
  diagnostic_endpoint?: unknown
  update_manifest_url?: unknown
  update_public_key_pem?: unknown
}

function validRemoteUrl(value: string, allowLoopback: boolean): string {
  const parsed = new URL(value)
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.protocol !== "https:" && !(allowLoopback && loopback && parsed.protocol === "http:"))
  ) {
    throw new Error("Remote service URL must use HTTPS without credentials or fragments.")
  }
  return parsed.toString()
}

function parseConfig(
  raw: RawRemoteServicesConfig,
  allowLoopback: boolean,
): RemoteServicesConfig {
  const allowed = new Set([
    "telemetry_endpoint",
    "diagnostic_endpoint",
    "update_manifest_url",
    "update_public_key_pem",
  ])
  if (!Object.keys(raw).every((key) => allowed.has(key))) {
    throw new Error("Remote services config contains unsupported fields.")
  }
  const telemetryEndpoint =
    typeof raw.telemetry_endpoint === "string" && raw.telemetry_endpoint.trim()
      ? validRemoteUrl(raw.telemetry_endpoint, allowLoopback)
      : undefined
  const diagnosticEndpoint =
    typeof raw.diagnostic_endpoint === "string" && raw.diagnostic_endpoint.trim()
      ? validRemoteUrl(raw.diagnostic_endpoint, allowLoopback)
      : undefined
  const updateManifestUrl =
    typeof raw.update_manifest_url === "string" && raw.update_manifest_url.trim()
      ? validRemoteUrl(raw.update_manifest_url, allowLoopback)
      : undefined
  const updatePublicKeyPem =
    typeof raw.update_public_key_pem === "string" &&
    raw.update_public_key_pem.includes("BEGIN PUBLIC KEY") &&
    raw.update_public_key_pem.length <= 8_192
      ? raw.update_public_key_pem
      : undefined
  if (Boolean(updateManifestUrl) !== Boolean(updatePublicKeyPem)) {
    throw new Error("Update manifest URL and Ed25519 public key must be configured together.")
  }
  return { telemetryEndpoint, diagnosticEndpoint, updateManifestUrl, updatePublicKeyPem }
}

export async function loadRemoteServicesConfig(input: {
  packaged: boolean
  resourcesPath: string
  environment?: NodeJS.ProcessEnv
}): Promise<RemoteServicesConfig> {
  if (!input.packaged) {
    const environment = input.environment ?? process.env
    return parseConfig(
      {
        telemetry_endpoint:
          environment.SZTU_TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT,
        diagnostic_endpoint:
          environment.SZTU_DIAGNOSTIC_ENDPOINT ?? DEFAULT_DIAGNOSTIC_ENDPOINT,
        update_manifest_url: environment.SZTU_UPDATE_MANIFEST_URL,
        update_public_key_pem: environment.SZTU_UPDATE_PUBLIC_KEY_PEM,
      },
      true,
    )
  }

  const configPath = path.join(input.resourcesPath, "remote-services.json")
  let bytes: Buffer
  try {
    bytes = await readFile(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
  if (bytes.length > 64 * 1024) {
    throw new Error("Remote services config is too large.")
  }
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Remote services config must be a JSON object.")
  }
  return parseConfig(parsed as RawRemoteServicesConfig, false)
}
