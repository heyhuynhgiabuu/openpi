/**
 * Trust gate for project-level MCP configuration.
 *
 * Pi's built-in MCP extension decides whether `<cwd>/.pi/mcp.json` is read with
 * `ctx.isProjectTrusted()` (pi-coding-agent dist/extensions/mcp/index.js:1202,
 * which calls `loadMcpConfig({ projectTrusted })` in config.js:106). That value
 * comes from the session's SettingsManager, not from the resource loader, so the
 * sidecar must build the manager with the workspace trust it was started with.
 * Before this test existed the sidecar used `SettingsManager.create(cwd, agentDir)`
 * with no options, and the SDK default is `projectTrusted: true`
 * (dist/core/settings-manager.js:238) — an untrusted workspace would have had its
 * project mcp.json read.
 *
 * Covers the direct gate (settings, no sidecar process). The end-to-end proof is
 * in shippedPathMcpGuard.test.ts ("never launches .pi/mcp.json servers").
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionSettingsManager } from '../electron/pi/sessionSettings'

const tempDirs: string[] = []

function makeDirs(): { cwd: string; agentDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-mcp-trust-'))
  tempDirs.push(root)
  const cwd = path.join(root, 'workspace')
  const agentDir = path.join(root, 'agent')
  fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true })
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(
    path.join(cwd, '.pi', 'mcp.json'),
    JSON.stringify({
      mcpServers: { project: { command: 'project-server', args: [] } },
    })
  )
  fs.writeFileSync(
    path.join(agentDir, 'mcp.json'),
    JSON.stringify({
      mcpServers: { global: { command: 'global-server', args: [] } },
    })
  )
  return { cwd, agentDir }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('MCP config trust gate', () => {
  it('the SDK default is trusted, which is why the sidecar must pass the flag', () => {
    // The regression this guards: no options meant `projectTrusted: true`.
    const { cwd, agentDir } = makeDirs()
    expect(SettingsManager.create(cwd, agentDir).isProjectTrusted()).toBe(true)
  })

  it('reports trusted for the session manager of a trusted workspace', () => {
    const { cwd, agentDir } = makeDirs()
    const settings = createSessionSettingsManager(cwd, agentDir, true)
    expect(settings.isProjectTrusted()).toBe(true)
    expect(settings.getSettings().defaultTools).toBeUndefined()
  })

  it('reports untrusted for the session manager of an untrusted workspace', () => {
    const { cwd, agentDir } = makeDirs()
    const settings = createSessionSettingsManager(cwd, agentDir, false)
    // This single boolean is what Pi's MCP extension gates .pi/mcp.json on.
    expect(settings.isProjectTrusted()).toBe(false)
    // Global settings are still read.
    expect(settings.getGlobalSettings()).toBeTruthy()
  })
})
