/**
 * Settings managers the sidecar hands to Pi.
 *
 * This exists for one security property: `ctx.isProjectTrusted()` must
 * report the sidecar's workspace trust. Pi's built-in MCP extension gates
 * `<cwd>/.pi/mcp.json` on exactly that call (pi-coding-agent
 * dist/extensions/mcp/index.js:1202 -> config.js:106 `loadMcpConfig`), so a
 * settings manager that defaults `projectTrusted` to the SDK's `true` would let
 * an untrusted workspace's project config take effect.
 *
 * Unrelated to this: an untrusted workspace also skips the builtins entirely
 * through `noExtensions` (see getResourceLoader), so this is the second of two
 * independent guards.
 */
import { SettingsManager } from '@earendil-works/pi-coding-agent'

/**
 * The effective settings manager for a session. Trusted: project + global files.
 * Untrusted: global only, and an in-memory manager (so nothing can write project
 * settings), still reporting `isProjectTrusted() === false`.
 */
export function createSessionSettingsManager(
  cwd: string,
  agentDir: string,
  workspaceTrusted: boolean
): SettingsManager {
  const fileSettingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: workspaceTrusted,
  })
  if (workspaceTrusted) return fileSettingsManager
  return SettingsManager.inMemory(fileSettingsManager.getGlobalSettings(), {
    projectTrusted: false,
  })
}
