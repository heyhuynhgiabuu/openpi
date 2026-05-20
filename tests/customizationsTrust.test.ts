import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverCustomizations } from '../electron/services/customizations'

let tmp: string | null = null

function makeFixture() {
  tmp = mkdtempSync(join(tmpdir(), 'openpi-customizations-'))
  const cwd = join(tmp, 'workspace')
  const agentDir = join(tmp, 'agent')
  mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(cwd, '.pi', 'extensions', 'danger.ts'), 'export default {}\n')
  return { cwd, agentDir }
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('customization workspace trust inventory', () => {
  it('marks project extensions disabled until the workspace is trusted', async () => {
    const { cwd, agentDir } = makeFixture()

    const untrusted = await discoverCustomizations({ cwd, agentDir, workspaceTrusted: false })
    const untrustedExtension = untrusted.items.find(
      (item) => item.type === 'extensions' && item.scope === 'project'
    )

    expect(untrusted.workspaceTrusted).toBe(false)
    expect(untrustedExtension).toMatchObject({
      name: 'danger',
      enabled: false,
    })
    expect(untrustedExtension?.warning).toContain('workspace trust')

    const trusted = await discoverCustomizations({ cwd, agentDir, workspaceTrusted: true })
    const trustedExtension = trusted.items.find(
      (item) => item.type === 'extensions' && item.scope === 'project'
    )

    expect(trusted.workspaceTrusted).toBe(true)
    expect(trustedExtension).toMatchObject({
      name: 'danger',
      enabled: true,
      warning: undefined,
    })
  })
})
