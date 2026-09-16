/**
 * Regression guard for applyGetters: getter-backed members must stay reactive
 * (a read inside a Solid computation tracks the underlying signal) and must
 * be defined as getters on the target object — never snapshot values via
 * object spread, which would freeze them at their initial value.
 */
import { createMemo, createRoot, createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { applyGetters } from '../src/hooks/session/getters'

describe('applyGetters', () => {
  it('keeps getter-backed reads reactive: memoized computations rerun', () => {
    createRoot((dispose) => {
      const [ready, setReady] = createSignal<{ cwd: string } | null>(null)
      const session = applyGetters({}, { ready })

      let computationReads = 0
      const cwd = createMemo(() => {
        computationReads += 1
        return session.ready?.cwd ?? null
      })

      expect(cwd()).toBeNull()
      expect(computationReads).toBe(1)
      setReady({ cwd: '/ws' })
      // The memo tracked the getter read and recomputed on the signal change.
      expect(cwd()).toBe('/ws')
      expect(computationReads).toBe(2)
      dispose()
    })
  })

  it('defines real getters on the target, not snapshot values', () => {
    createRoot((dispose) => {
      const [count, setCount] = createSignal(1)
      const target: Record<string, unknown> = { existing: 'kept' }
      const session = applyGetters(target, { count })

      const descriptor = Object.getOwnPropertyDescriptor(session, 'count')
      expect(typeof descriptor?.get).toBe('function')
      // A spread snapshot must NOT equal the live object's behavior.
      const spreadSnapshot = { ...session }
      setCount(2)
      expect(session.count).toBe(2)
      expect(spreadSnapshot.count).toBe(1)
      dispose()
    })
  })
})
