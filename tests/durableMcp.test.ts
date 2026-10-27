import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { openDurableHarness } from '../electron/pi/durable/harness'
import { loadMcpExtension } from '../electron/pi/durable/mcp'
import { loadDurableMcpConfig, mcpToolName } from '../electron/pi/durable/mcpConfig'
import { MCP_ECHO_PREFIX } from './fixtures/mcp-stdio-server.js'

/**
 * Phase 8.2c: `.pi/mcp.json` parity. The bridge spawns the real fixture server over stdio, so these
 * tests cover config parsing, the trust gate, tool naming, and a genuine tool round trip.
 */

let root = ''
let agentDir = ''
let workspacePath = ''

const FIXTURE = join(import.meta.dirname, 'fixtures', 'mcp-stdio-server.js')

async function writeMcpFile(filePath: string, servers: Record<string, unknown>): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, JSON.stringify({ mcpServers: servers }), 'utf-8')
}

function fixtureServer(): Record<string, unknown> {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [FIXTURE],
    description: 'fixture server',
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-mcp-'))
  agentDir = join(root, 'agent')
  workspacePath = join(root, 'workspace')
  await mkdir(agentDir, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('durable mcp config', () => {
  it('reads the global config and names tools with the Pi namespace prefix', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), { fixture: fixtureServer() })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    expect(config.errors).toEqual([])
    expect(config.servers).toHaveLength(1)
    expect(config.servers[0]).toMatchObject({ name: 'fixture', command: process.execPath })
    expect(mcpToolName('fixture', 'echo')).toBe('mcp__fixture__echo')
  })

  it('ignores the project config unless the workspace is trusted', async () => {
    await writeMcpFile(join(workspacePath, '.pi', 'mcp.json'), { fixture: fixtureServer() })
    expect(
      loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false }).servers
    ).toEqual([])
    expect(
      loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: true }).servers
    ).toHaveLength(1)
  })

  it('reports non-stdio and malformed entries instead of dropping them silently', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), {
      remote: { type: 'http', url: 'https://example.test/mcp' },
      broken: { args: ['no-command'] },
    })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    expect(config.servers).toEqual([])
    expect(config.errors).toHaveLength(2)
  })

  it('keeps the exposure setting and defaults to codemode', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), {
      fixture: { ...fixtureServer(), exposure: 'hidden' },
      plain: fixtureServer(),
    })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    expect(config.servers.find((server) => server.name === 'fixture')?.exposure).toBe('hidden')
    expect(config.servers.find((server) => server.name === 'plain')?.exposure).toBe('codemode')
  })

  it('registers no tools for a hidden server', async () => {
    const bridge = await loadMcpExtension(
      [
        {
          name: 'fixture',
          command: process.execPath,
          args: [FIXTURE],
          env: {},
          enabled: true,
          exposure: 'hidden',
          timeoutMs: 60_000,
        },
      ],
      workspacePath
    )
    expect(bridge.extension).toBeUndefined()
    await bridge.close()
  })

  it('converts the configured timeout from seconds to milliseconds', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), { fixture: { ...fixtureServer(), timeout: 5 } })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    expect(config.servers[0].timeoutMs).toBe(5000)
  })

  it('honors enabled: false', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), {
      fixture: { ...fixtureServer(), enabled: false },
    })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    expect(config.servers[0].enabled).toBe(false)
  })
})

describe('durable mcp bridge', () => {
  it('registers the fixture tool as deferred and runs it', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), { fixture: fixtureServer() })
    const config = loadDurableMcpConfig({ agentDir, workspacePath, projectTrusted: false })
    const bridge = await loadMcpExtension(config.servers, workspacePath)
    try {
      expect(bridge.errors).toEqual([])
      const tool = bridge.extension?.tools?.find(
        (candidate) => candidate.name === 'mcp__fixture__echo'
      )
      expect(tool).toBeDefined()
      // Not offered up front: `tool_search` loads it for the next request.
      expect(tool?.deferred).toBe(true)
      // The server's own schema and description reach the model, not an empty placeholder.
      expect(JSON.stringify(tool?.parameters ?? {})).toContain('text')
      expect(tool?.description.toLowerCase()).toContain('echo')

      const output = await tool?.execute(
        { text: 'hello' } as never,
        {
          diagnostic: () => {},
        } as never,
        {} as never
      )
      expect(JSON.stringify(output)).toContain(MCP_ECHO_PREFIX)
    } finally {
      await bridge.close()
    }
  })

  it('returns no extension when every server is disabled', async () => {
    const bridge = await loadMcpExtension(
      [
        {
          name: 'fixture',
          command: process.execPath,
          args: [FIXTURE],
          env: {},
          enabled: false,
          exposure: 'codemode' as const,
          timeoutMs: 60_000,
        },
      ],
      workspacePath
    )
    expect(bridge.extension).toBeUndefined()
    expect(bridge.errors).toEqual([])
    await bridge.close()
  })

  it('reports a server that cannot start instead of throwing', async () => {
    const bridge = await loadMcpExtension(
      [
        {
          name: 'broken',
          command: 'definitely-not-a-real-command-xyz',
          args: [],
          env: {},
          enabled: true,
          exposure: 'codemode' as const,
          timeoutMs: 60_000,
        },
      ],
      workspacePath
    )
    expect(bridge.extension).toBeUndefined()
    expect(bridge.errors[0]).toContain('broken')
    await bridge.close()
  })
})

describe('durable mcp exposure through tool_search', () => {
  it('lets the model find the deferred tool with tool_search and then call it', async () => {
    await writeMcpFile(join(agentDir, 'mcp.json'), { fixture: fixtureServer() })
    const faux = fauxProvider()
    const contexts: TranscriptContext[] = []
    const answer = () => fauxAssistantMessage([fauxText('done')], { stopReason: 'stop' as const })
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('tool_search', { query: 'echo' }, { id: 's1' })], {
        stopReason: 'toolUse' as const,
      }),
      fauxAssistantMessage([fauxToolCall('mcp__fixture__echo', { text: 'hello' }, { id: 's2' })], {
        stopReason: 'toolUse' as const,
      }),
      (context) => {
        contexts.push(context)
        return answer()
      },
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
      registerProviders: (models) => models.setProvider(faux.provider),
      userAgentDir: agentDir,
      workspacePath,
      mcp: true,
    })
    try {
      const result = await harness.prompt('call the fixture echo tool')
      expect(result.status).toBe('done')
      // The search result named the tool, and the tool's own output reached the model.
      const seen = JSON.stringify(contexts.at(-1) ?? {})
      expect(seen).toContain('mcp__fixture__echo')
      expect(seen).toContain(MCP_ECHO_PREFIX)
    } finally {
      await harness.close()
    }
  })
})
