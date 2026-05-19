/**
 * IPC Zod schema roundtrip tests.
 *
 * Validates that every key IPC payload schema parses valid data correctly
 * and rejects invalid data.  Schemas are the contract between Electron main
 * and the renderer — a parse failure at runtime is a hard crash risk.
 */

import { describe, expect, it } from 'vitest'
import {
  appInfoSchema,
  bashExecutionResultSchema,
  customizationItemSchema,
  deleteFileRequestSchema,
  deleteFileResultSchema,
  diagnosticsBundleSchema,
  gitBranchInfoSchema,
  gitBranchSchema,
  goalUpdateSchema,
  newSessionSchema,
  openSessionSchema,
  pathProtectionRequestSchema,
  pathProtectionResultSchema,
  pickWorkspaceResultSchema,
  planUpdateSchema,
  sessionBashSchema,
  sessionListOptionsSchema,
  sessionMessagesRequestSchema,
  sessionPromptSchema,
  sessionStatsSchema,
  setModelSchema,
  setThinkingSchema,
  workspaceInfoSchema,
  workspaceSummaryInfoSchema,
  workspaceSummaryRequestSchema,
  workspaceTrustRequestSchema,
  workspaceTrustResultSchema,
} from '../src/lib/ipc'

// ---------------------------------------------------------------------------
// pickWorkspaceResultSchema
// ---------------------------------------------------------------------------
describe('pickWorkspaceResultSchema', () => {
  it('parses a picked workspace', () => {
    expect(pickWorkspaceResultSchema.parse({ cancelled: false, path: '/p' })).toEqual({
      cancelled: false,
      path: '/p',
    })
  })

  it('parses cancelled result with no path', () => {
    expect(pickWorkspaceResultSchema.parse({ cancelled: true })).toEqual({
      cancelled: true,
      path: undefined,
    })
  })
})

// ---------------------------------------------------------------------------
// appInfoSchema
// ---------------------------------------------------------------------------
describe('appInfoSchema', () => {
  const valid = { name: 'OpenPi', version: '0.1.16', releaseChannel: 'beta' }

  it('parses valid app info', () => {
    expect(appInfoSchema.parse(valid)).toEqual(valid)
  })

  it('accepts null releaseChannel', () => {
    expect(
      appInfoSchema.parse({ name: 'OpenPi', version: '0.1.16', releaseChannel: null })
    ).toEqual({ name: 'OpenPi', version: '0.1.16', releaseChannel: null })
  })

  it('rejects missing name', () => {
    expect(() => appInfoSchema.parse({ version: '0.1.16' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// deleteFileRequestSchema / deleteFileResultSchema
// ---------------------------------------------------------------------------
describe('delete file schemas', () => {
  it('parses a valid delete file request', () => {
    expect(deleteFileRequestSchema.parse({ path: 'src/App.tsx' })).toEqual({ path: 'src/App.tsx' })
  })

  it('rejects empty delete paths', () => {
    expect(() => deleteFileRequestSchema.parse({ path: '' })).toThrow()
  })

  it('parses delete file results', () => {
    expect(deleteFileResultSchema.parse({ trashed: true })).toEqual({ trashed: true })
    expect(deleteFileResultSchema.parse({ trashed: false })).toEqual({ trashed: false })
  })
})

// ---------------------------------------------------------------------------
// sessionPromptSchema
// ---------------------------------------------------------------------------
describe('sessionPromptSchema', () => {
  it('parses a valid prompt', () => {
    expect(sessionPromptSchema.parse({ text: 'hello' })).toEqual({ text: 'hello' })
  })

  it('parses prompt with contextPrefix', () => {
    expect(sessionPromptSchema.parse({ text: 'hello', contextPrefix: 'fix the bug' })).toEqual({
      text: 'hello',
      contextPrefix: 'fix the bug',
    })
  })

  it('rejects empty text', () => {
    expect(() => sessionPromptSchema.parse({ text: '' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// sessionBashSchema
// ---------------------------------------------------------------------------
describe('sessionBashSchema', () => {
  it('parses a valid bash command', () => {
    expect(sessionBashSchema.parse({ command: 'ls -la' })).toEqual({
      command: 'ls -la',
    })
  })

  it('parses with excludeFromContext', () => {
    expect(sessionBashSchema.parse({ command: 'ls', excludeFromContext: true })).toEqual({
      command: 'ls',
      excludeFromContext: true,
    })
  })

  it('rejects empty command', () => {
    expect(() => sessionBashSchema.parse({ command: '' })).toThrow()
  })

  it('rejects command exceeding 100k chars', () => {
    expect(() => sessionBashSchema.parse({ command: 'x'.repeat(100_001) })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// bashExecutionResultSchema
// ---------------------------------------------------------------------------
describe('bashExecutionResultSchema', () => {
  it('parses a successful result', () => {
    const result = bashExecutionResultSchema.parse({
      output: 'hello',
      cancelled: false,
      truncated: false,
    })
    expect(result.output).toBe('hello')
    expect(result.cancelled).toBe(false)
  })

  it('parses with exitCode and fullOutputPath', () => {
    const result = bashExecutionResultSchema.parse({
      output: 'partial',
      exitCode: 1,
      cancelled: false,
      truncated: true,
      fullOutputPath: '/tmp/log.txt',
    })
    expect(result.exitCode).toBe(1)
    expect(result.fullOutputPath).toBe('/tmp/log.txt')
  })
})

// ---------------------------------------------------------------------------
// setModelSchema
// ---------------------------------------------------------------------------
describe('setModelSchema', () => {
  it('parses provider + modelId', () => {
    expect(setModelSchema.parse({ provider: 'openai', modelId: 'gpt-4' })).toEqual({
      provider: 'openai',
      modelId: 'gpt-4',
    })
  })

  it('rejects missing provider', () => {
    expect(() => setModelSchema.parse({ modelId: 'gpt-4' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// setThinkingSchema
// ---------------------------------------------------------------------------
describe('setThinkingSchema', () => {
  it('parses any string level', () => {
    expect(setThinkingSchema.parse({ level: 'high' }).level).toBe('high')
    expect(setThinkingSchema.parse({ level: 'off' }).level).toBe('off')
    // Schema is z.string() with no enum — any string is valid
    expect(setThinkingSchema.parse({ level: 'extreme' }).level).toBe('extreme')
  })
})

// ---------------------------------------------------------------------------
// sessionListOptionsSchema
// ---------------------------------------------------------------------------
describe('sessionListOptionsSchema', () => {
  it('defaults all fields when undefined', () => {
    // .optional().default({}) means undefined → {}
    const result = sessionListOptionsSchema.parse(undefined)
    expect(result.query).toBeUndefined()
    expect(result.sortBy).toBeUndefined()
    expect(result.limit).toBeUndefined()
  })

  it('parses with query and limit', () => {
    const result = sessionListOptionsSchema.parse({ query: 'fix bug', limit: 10, offset: 5 })
    expect(result.query).toBe('fix bug')
    expect(result.limit).toBe(10)
    expect(result.offset).toBe(5)
  })

  it('parses with sortBy and groupBy', () => {
    const result = sessionListOptionsSchema.parse({ sortBy: 'updated', groupBy: 'workspace' })
    expect(result.sortBy).toBe('updated')
    expect(result.groupBy).toBe('workspace')
  })

  it('rejects invalid sortBy', () => {
    expect(() => sessionListOptionsSchema.parse({ sortBy: 'invalid' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// openSessionSchema
// ---------------------------------------------------------------------------
describe('openSessionSchema', () => {
  it('parses a session path', () => {
    expect(openSessionSchema.parse({ path: '/tmp/test.jsonl' })).toEqual({
      path: '/tmp/test.jsonl',
    })
  })

  it('rejects empty path', () => {
    expect(() => openSessionSchema.parse({ path: '' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// sessionMessagesRequestSchema
// ---------------------------------------------------------------------------
describe('sessionMessagesRequestSchema', () => {
  it('parses valid request', () => {
    const r = sessionMessagesRequestSchema.parse({
      path: '/tmp/s.jsonl',
      limit: 100,
    })
    expect(r.path).toBe('/tmp/s.jsonl')
    expect(r.limit).toBe(100)
  })

  it('parses with beforeEntryId', () => {
    const r = sessionMessagesRequestSchema.parse({
      path: '/tmp/s.jsonl',
      beforeEntryId: 'abc12345',
    })
    expect(r.beforeEntryId).toBe('abc12345')
  })

  it('rejects empty path', () => {
    expect(() => sessionMessagesRequestSchema.parse({ path: '' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// newSessionSchema
// ---------------------------------------------------------------------------
describe('newSessionSchema', () => {
  it('defaults to empty object when undefined', () => {
    expect(newSessionSchema.parse(undefined)).toEqual({})
  })

  it('parses with cwd', () => {
    expect(newSessionSchema.parse({ cwd: '/tmp' })).toEqual({ cwd: '/tmp' })
  })

  it('parses undefined', () => {
    expect(newSessionSchema.parse(undefined)).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// gitBranchSchema
// ---------------------------------------------------------------------------
describe('gitBranchSchema', () => {
  it('parses cwd', () => {
    expect(gitBranchSchema.parse({ cwd: '/p' })).toEqual({ cwd: '/p' })
  })
})

// ---------------------------------------------------------------------------
// gitBranchInfoSchema
// ---------------------------------------------------------------------------
describe('gitBranchInfoSchema', () => {
  it('parses valid branch info', () => {
    expect(gitBranchInfoSchema.parse({ branch: 'main' })).toEqual({ branch: 'main' })
  })

  it('accepts null branch', () => {
    expect(gitBranchInfoSchema.parse({ branch: null })).toEqual({ branch: null })
  })
})

// ---------------------------------------------------------------------------
// sessionStatsSchema
// ---------------------------------------------------------------------------
describe('sessionStatsSchema', () => {
  it('parses valid stats', () => {
    const stats = sessionStatsSchema.parse({
      inputTokens: 10000,
      outputTokens: 5000,
      cacheReadTokens: 2000,
      cacheWriteTokens: 500,
      cost: 0.0123,
      contextUsagePercent: 45,
      sessionFile: '/tmp/s.jsonl',
      sessionId: 'abc-123',
      isStreaming: false,
    })
    expect(stats.inputTokens).toBe(10000)
    expect(stats.outputTokens).toBe(5000)
    expect(stats.cost).toBe(0.0123)
  })

  it('accepts null contextUsagePercent, sessionFile, sessionId', () => {
    const stats = sessionStatsSchema.parse({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      contextUsagePercent: null,
      sessionFile: null,
      sessionId: null,
      isStreaming: false,
    })
    expect(stats.contextUsagePercent).toBeNull()
    expect(stats.sessionFile).toBeNull()
    expect(stats.sessionId).toBeNull()
  })

  it('parses isStreaming correctly', () => {
    expect(
      sessionStatsSchema.parse({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        contextUsagePercent: null,
        sessionFile: null,
        sessionId: null,
        isStreaming: true,
      }).isStreaming
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// workspaceInfoSchema
// ---------------------------------------------------------------------------
describe('workspaceInfoSchema', () => {
  const valid = {
    path: '/home/user/project',
    displayName: 'project',
    lastOpenedAt: '2026-05-19T12:00:00.000Z',
    sessionCount: 5,
  }

  it('parses valid workspace info', () => {
    expect(workspaceInfoSchema.parse(valid)).toEqual(valid)
  })

  it('allows null lastOpenedAt', () => {
    const result = workspaceInfoSchema.parse({
      path: '/tmp/a',
      displayName: 'a',
      sessionCount: 0,
      lastOpenedAt: null,
    })
    expect(result.lastOpenedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// workspaceSummaryRequestSchema
// ---------------------------------------------------------------------------
describe('workspaceSummaryRequestSchema', () => {
  it('parses cwd', () => {
    expect(workspaceSummaryRequestSchema.parse({ cwd: '/p' })).toEqual({ cwd: '/p' })
  })
})

// ---------------------------------------------------------------------------
// workspaceSummaryInfoSchema
// ---------------------------------------------------------------------------
describe('workspaceSummaryInfoSchema', () => {
  it('parses valid summary', () => {
    const result = workspaceSummaryInfoSchema.parse({
      cwd: '/p',
      displayName: 'p',
      branch: 'main',
      lastModifiedAt: '2026-05-19T12:00:00.000Z',
    })
    expect(result.cwd).toBe('/p')
    expect(result.displayName).toBe('p')
    expect(result.branch).toBe('main')
  })

  it('accepts null branch and lastModifiedAt', () => {
    const result = workspaceSummaryInfoSchema.parse({
      cwd: '/p',
      displayName: 'p',
      branch: null,
      lastModifiedAt: null,
    })
    expect(result.branch).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// workspaceTrustRequestSchema / workspaceTrustResultSchema
// ---------------------------------------------------------------------------
describe('workspaceTrustSchema', () => {
  it('parses trust request', () => {
    expect(workspaceTrustRequestSchema.parse({ cwd: '/p', trusted: true })).toEqual({
      cwd: '/p',
      trusted: true,
    })
  })

  it('rejects missing cwd', () => {
    expect(() => workspaceTrustRequestSchema.parse({ trusted: true })).toThrow()
  })

  it('parses trust result', () => {
    expect(
      workspaceTrustResultSchema.parse({
        cwd: '/p',
        trusted: true,
        trustedAt: '2026-05-19T12:00:00.000Z',
      })
    ).toEqual({ cwd: '/p', trusted: true, trustedAt: '2026-05-19T12:00:00.000Z' })
  })

  it('allows null trustedAt', () => {
    expect(
      workspaceTrustResultSchema.parse({ cwd: '/p', trusted: false, trustedAt: null })
    ).toEqual({
      cwd: '/p',
      trusted: false,
      trustedAt: null,
    })
  })
})

// ---------------------------------------------------------------------------
// pathProtectionRequestSchema / pathProtectionResultSchema
// ---------------------------------------------------------------------------
describe('pathProtectionSchema', () => {
  it('parses a protection request', () => {
    expect(pathProtectionRequestSchema.parse({ path: '/tmp/file' })).toEqual({
      path: '/tmp/file',
    })
  })

  it('parses protection result with all fields', () => {
    const result = pathProtectionResultSchema.parse({
      protected: true,
      level: 'hard',
      rule: 'ssh-dir',
      reason: 'SSH keys are sensitive',
    })
    expect(result.protected).toBe(true)
    expect(result.level).toBe('hard')
  })

  it('allows null level/rule/reason when not protected', () => {
    const result = pathProtectionResultSchema.parse({
      protected: false,
      level: null,
      rule: null,
      reason: null,
    })
    expect(result.protected).toBe(false)
    expect(result.level).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// diagnosticsBundleSchema
// ---------------------------------------------------------------------------
describe('diagnosticsBundleSchema', () => {
  const valid = {
    generatedAt: '2026-05-19T12:00:00.000Z',
    app: { version: '0.1.16' },
    runtime: { memory: '512MB' },
    workspace: { cwd: '/tmp' },
    sidecar: { pid: 123 },
    resources: null,
    git: null,
    database: { size: '1MB' },
    notes: ['note 1'],
  }

  it('parses valid bundle', () => {
    const result = diagnosticsBundleSchema.parse(valid)
    expect(result.generatedAt).toBe(valid.generatedAt)
    expect(result.notes).toEqual(['note 1'])
  })

  it('allows null resources and git', () => {
    const result = diagnosticsBundleSchema.parse({ ...valid, resources: null, git: null })
    expect(result.resources).toBeNull()
    expect(result.git).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// customizationItemSchema
// ---------------------------------------------------------------------------
describe('customizationItemSchema', () => {
  const valid = {
    id: 'ext-1',
    type: 'extensions' as const,
    name: 'my-extension',
    scope: 'user' as const,
    origin: 'top-level' as const,
    source: 'user',
    enabled: true,
    path: '/home/user/.pi/agent/extensions/my-ext.ts',
  }

  it('parses a valid customization item', () => {
    const result = customizationItemSchema.parse(valid)
    expect(result.id).toBe('ext-1')
    expect(result.type).toBe('extensions')
    expect(result.path).toBe('/home/user/.pi/agent/extensions/my-ext.ts')
  })

  it('allows optional description and riskLevel', () => {
    const result = customizationItemSchema.parse(valid)
    expect(result.description).toBeUndefined()
    expect(result.riskLevel).toBeUndefined()
  })

  it('rejects invalid type', () => {
    expect(() => customizationItemSchema.parse({ ...valid, type: 'widgets' })).toThrow()
  })

  it('accepts null path', () => {
    const result = customizationItemSchema.parse({ ...valid, path: null })
    expect(result.path).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// planUpdateSchema
// ---------------------------------------------------------------------------
describe('planUpdateSchema', () => {
  it('parses plan updates', () => {
    const result = planUpdateSchema.parse({
      plan: [
        { step: 'Inspect harness state', status: 'completed' },
        { step: 'Wire plan sync', status: 'in_progress' },
        { step: 'Verify', status: 'pending' },
      ],
      timestamp: Date.now(),
    })
    expect(result.plan).toHaveLength(3)
    expect(result.plan[1]?.status).toBe('in_progress')
  })

  it('rejects empty plan steps', () => {
    expect(() =>
      planUpdateSchema.parse({
        plan: [{ step: '', status: 'pending' }],
        timestamp: Date.now(),
      })
    ).toThrow()
  })

  it('accepts cleared plans', () => {
    const result = planUpdateSchema.parse({ plan: [], timestamp: Date.now() })
    expect(result.plan).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// goalUpdateSchema
// ---------------------------------------------------------------------------
describe('goalUpdateSchema', () => {
  it('parses goal update with all fields', () => {
    const result = goalUpdateSchema.parse({
      objective: 'Fix bugs',
      status: 'running',
      tokenBudget: null,
      tokensUsed: 500,
      timeUsedSeconds: 120,
      timestamp: Date.now(),
    })
    expect(result.objective).toBe('Fix bugs')
    expect(result.status).toBe('running')
    expect(result.tokensUsed).toBe(500)
  })

  it('parses with tokenBudget', () => {
    const result = goalUpdateSchema.parse({
      objective: 'Refactor',
      status: 'idle',
      tokenBudget: 5000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      timestamp: Date.now(),
    })
    expect(result.tokenBudget).toBe(5000)
  })

  it('accepts null objective', () => {
    const result = goalUpdateSchema.parse({
      objective: null,
      status: null,
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      timestamp: Date.now(),
    })
    expect(result.objective).toBeNull()
    expect(result.status).toBeNull()
  })
})
