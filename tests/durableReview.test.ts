import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCall } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reviewGate } from '../electron/pi/durable/review'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'

/**
 * Phase 8 item 9 Slice B: the durable runtime asks before a write, the way the SDK path's
 * pre-apply review extension does. A user who turned the gate on must not get edits applied with
 * no prompt, which is what happened before this slice (the durable registry only ran the
 * protected-path policy hook).
 */

type Args = ToolCall['arguments']

function call(name: string, args: Args): ToolCall {
  return { type: 'toolCall', id: 'call-1', name, arguments: args }
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-durable-review-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Answers every request with `response(request)`, and records what was asked. */
function answering(response: (request: ExtensionUiRequest) => ExtensionUiResponse) {
  const asked: ExtensionUiRequest[] = []
  return {
    asked,
    ask: (request: ExtensionUiRequest): Promise<ExtensionUiResponse> => {
      asked.push(request)
      return Promise.resolve(response(request))
    },
  }
}

/**
 * How the renderer actually answers: a `confirm` prompt returns `confirmed`, a `preapply_review`
 * returns the approved hunk indexes. Answering one with the other must not count as approval.
 */
const approveAll = (request: ExtensionUiRequest): ExtensionUiResponse =>
  request.method === 'preapply_review'
    ? { id: request.id, approved: request.review.hunks.map((_, index) => index) }
    : { id: request.id, confirmed: true }

const denyAll = (request: ExtensionUiRequest): ExtensionUiResponse =>
  request.method === 'preapply_review'
    ? { id: request.id, approved: [] }
    : { id: request.id, confirmed: false }

describe('durable pre-apply review', () => {
  it('asks before a write, and lets it through when the user approves', async () => {
    const target = join(root, 'new.txt')
    const ui = answering(approveAll)
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(call('write', { path: target, content: 'hello\n' }))

    expect(decision).toBeUndefined()
    expect(ui.asked).toHaveLength(1)
    // A create is shown as a hunk review, not a bare yes/no: the user sees what will land.
    expect(ui.asked[0]?.method).toBe('preapply_review')
    expect(ui.asked[0]?.title).toContain('new.txt')
  })

  it('blocks the write when the user denies, with a reason the model can read', async () => {
    const target = join(root, 'new.txt')
    const ui = answering(denyAll)
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(call('write', { path: target, content: 'x' }))

    expect(decision?.block).toContain('new.txt')
    expect(decision?.block).toContain('review')
  })

  it('treats a cancelled prompt as a denial', async () => {
    const target = join(root, 'new.txt')
    const ui = answering((request) => ({ id: request.id, cancelled: true }))
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(call('write', { path: target, content: 'x' }))

    expect(decision?.block).toBeTruthy()
  })

  it('treats a response carrying no answer as a denial, rather than guessing it approved', async () => {
    const target = join(root, 'new.txt')
    // An answer with neither `approved` nor `confirmed`: a client that forgot to fill one in, or a
    // future method this gate does not know. Silence must never read as consent.
    const ui = answering((request) => ({ id: request.id }))
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(call('write', { path: target, content: 'x' }))

    expect(decision?.block).toContain('not answered')
  })

  it('never asks when the gate is off', async () => {
    const target = join(root, 'new.txt')
    const ui = answering(approveAll)
    const gate = reviewGate({ enabled: false, ask: ui.ask, workspacePath: root })

    expect(await gate.decide(call('write', { path: target, content: 'x' }))).toBeUndefined()
    expect(ui.asked).toEqual([])
  })

  it('does not ask about tools that change nothing on disk', async () => {
    const ui = answering(approveAll)
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    expect(await gate.decide(call('read', { path: join(root, 'a.txt') }))).toBeUndefined()
    expect(await gate.decide(call('bash', { command: 'ls' }))).toBeUndefined()
    expect(ui.asked).toEqual([])
  })

  it('shows an edit as a reviewable change instead of a bare confirm', async () => {
    const target = join(root, 'existing.txt')
    await writeFile(target, 'one\ntwo\n', 'utf8')
    const ui = answering(approveAll)
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(
      call('edit', { path: target, edits: [{ oldText: 'two', newText: 'TWO' }] })
    )

    expect(decision).toBeUndefined()
    expect(ui.asked).toHaveLength(1)
    const asked = ui.asked[0]
    expect(asked?.method).toBe('preapply_review')
    expect(asked?.method === 'preapply_review' ? asked.review.path : '').toContain('existing.txt')
  })

  it('says whether nothing was approved or only part of it, because the model reads this', async () => {
    const target = join(root, 'existing.txt')
    await writeFile(target, 'one\ntwo\nthree\n', 'utf8')
    const edit = {
      path: target,
      edits: [
        { oldText: 'one', newText: 'ONE' },
        { oldText: 'three', newText: 'THREE' },
      ],
    }

    const denied = reviewGate({ enabled: true, ask: answering(denyAll).ask, workspacePath: root })
    expect((await denied.decide(call('edit', edit)))?.block).toContain('denied')

    const partial = reviewGate({
      enabled: true,
      ask: answering((request) => ({ id: request.id, approved: [0] })).ask,
      workspacePath: root,
    })
    expect((await partial.decide(call('edit', edit)))?.block).toContain('all or none')
  })

  it('blocks the edit when the review is not approved', async () => {
    const target = join(root, 'existing.txt')
    await writeFile(target, 'one\ntwo\n', 'utf8')
    const ui = answering((request) => ({ id: request.id, approved: [] }))
    const gate = reviewGate({ enabled: true, ask: ui.ask, workspacePath: root })

    const decision = await gate.decide(
      call('edit', { path: target, edits: [{ oldText: 'two', newText: 'TWO' }] })
    )

    expect(decision?.block).toContain('existing.txt')
  })
})
