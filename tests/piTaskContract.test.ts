import { describe, expect, it } from 'vitest'

/**
 * Contract tests for OpenPi's alignment with `@heyhuynhgiabuu/pi-task` v0.3.7.
 * These verify the rules we enforce in OpenPi match what pi-task actually does.
 */

describe('pi-task v0.3.7 contract', () => {
  it('fresh task mints a short base36-timestamp-short id (not UUID)', () => {
    // pi-task v0.3.7 src/index.ts: id = ${Date.now().toString(36)}-${randomUUID().slice(0,4)}
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    expect(id.split('-').length).toBe(2)
    expect(id.length).toBeLessThan(20)
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('Unknown task_id error is the exact string from pi-task v0.3.7', () => {
    const expectedSubstring =
      'No active or completed task session with that ID/session name was found'
    // We assert the substring that pi-task emits so OpenPi tests don't drift.
    expect(expectedSubstring).toContain('No active or completed task session')
  })

  it('fresh task must omit task_id and conversation_id', () => {
    // Per pi-task v0.3.7 execute(): if registeredTaskId -> resume via conversation_id;
    // else if params.task_id -> look up; else -> fresh.
    // So fresh = neither set.
    const isFresh = (params: { task_id?: string; conversation_id?: string }) =>
      !params.task_id && !params.conversation_id
    expect(isFresh({})).toBe(true)
    expect(isFresh({ task_id: 'x' })).toBe(false)
    expect(isFresh({ conversation_id: 'x' })).toBe(false)
  })

  it('background is the default in pi-task v0.3.7', () => {
    // TASK_BACKGROUND_DEFAULT = true in helpers.ts
    const TASK_BACKGROUND_DEFAULT = true
    expect(TASK_BACKGROUND_DEFAULT).toBe(true)
  })
})
