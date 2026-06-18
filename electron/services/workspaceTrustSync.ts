/**
 * workspaceTrustSync.ts — Persist OpenPi's workspace trust decision to a
 * file the Pi sidecar/bridge can read, so Pi's `project_trust` event
 * handler can defer to the same source of truth as the OpenPi UI.
 *
 * The file lives at `~/.pi/agent/.openpi-workspace-trust.json` and is a
 * `{ [cwd]: 'trusted' | 'untrusted' }` map. We use a single file with
 * a cwd-keyed map so the bridge can look up the decision for the cwd
 * it's currently running in, regardless of session history.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function getAgentDir(): string {
  // Tests can override via OPENPI_AGENT_DIR to redirect the sync file.
  return process.env.OPENPI_AGENT_DIR ?? path.join(os.homedir(), '.pi', 'agent')
}

function getFilePath(): string {
  return path.join(getAgentDir(), '.openpi-workspace-trust.json')
}

function readMap(): Record<string, 'trusted' | 'untrusted'> {
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, 'trusted' | 'untrusted'>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, 'trusted' | 'untrusted'>): void {
  try {
    fs.mkdirSync(path.dirname(getFilePath()), { recursive: true })
    fs.writeFileSync(getFilePath(), `${JSON.stringify(map, null, 2)}\n`, 'utf-8')
  } catch {
    // Non-fatal: the bridge will fall back to Pi's defaultProjectTrust
    // policy if the file is missing or unwritable.
  }
}

export function setWorkspaceTrustSync(cwd: string, decision: 'trusted' | 'untrusted'): void {
  const map = readMap()
  map[cwd] = decision
  writeMap(map)
}

export function clearWorkspaceTrustSync(cwd: string): void {
  const map = readMap()
  delete map[cwd]
  writeMap(map)
}
