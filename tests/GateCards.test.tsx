import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, expect, it, vi } from 'vitest'
import { GateCards } from '../pwa/GateCards'
import { api, type RemoteGate } from '../pwa/api'

const review = {
  path: 'src/example.ts',
  summary: 'Two edits',
  hunks: [
    { diff: '-old\n+new', removed: 1, added: 1 },
    { diff: '+<script>text only</script>', removed: 0, added: 1 },
  ],
}

function setup(payload?: unknown) {
  const gate: RemoteGate = {
    id: 'gate-1',
    kind: 'confirm',
    title: 'Review changes',
    summary: 'Two edits',
    createdAt: 0,
    expiresAt: 9999999999999,
    gateToken: 'one-time-token',
    payload,
  }
  const decide = vi.spyOn(api, 'decideGate').mockResolvedValue({})
  return {
    decide,
    ...render(() => (
      <GateCards state={{ pending: [gate], notice: '' }} onUnauthenticated={() => {}} />
    )),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows every diff as text and Approve all submits all hunk indexes', () => {
  const { getByRole, getByText, container, decide } = setup(review)
  const approve = getByRole('button', { name: 'Approve all 2 hunks' })
  expect(getByText(review.path)).toBeTruthy()
  expect([...container.querySelectorAll('pre')].map((pre) => pre.textContent)).toEqual(
    review.hunks.map((hunk) => hunk.diff)
  )
  expect(container.querySelector('script')).toBeNull()
  fireEvent.click(approve)
  expect(decide).toHaveBeenCalledWith('gate-1', true, 'one-time-token', [0, 1])
})

it('keeps ordinary confirmations available without hunk indexes', () => {
  const { getByRole, decide } = setup()
  fireEvent.click(getByRole('button', { name: 'Approve' }))
  expect(decide).toHaveBeenCalledWith('gate-1', true, 'one-time-token', undefined)
})

it.each([{ hunks: [] }, { ...review, hunks: [{ diff: 42 }] }, null])(
  'blocks approval of an invalid review payload but still permits denial (%j)',
  (payload) => {
    const { getByRole, getByText, decide } = setup(payload)
    expect(getByText('Review unavailable. Deny or review on the desktop.')).toBeTruthy()
    expect(getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(getByRole('button', { name: 'Approve' }))
    expect(decide).not.toHaveBeenCalled()
    fireEvent.click(getByRole('button', { name: 'Deny' }))
    expect(decide).toHaveBeenCalledWith('gate-1', false, 'one-time-token', undefined)
  }
)
