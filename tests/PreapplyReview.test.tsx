import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreapplyReview } from '../src/components/PreapplyReview'
import type { PreapplyReview as Review } from '../src/lib/extensionUiTypes'

const review: Review = {
  path: 'src/App.tsx',
  summary: 'edit · -2 lines / +2 lines · 2 hunks',
  hunks: [
    { diff: '-one\n+ONE', removed: 1, added: 1 },
    { diff: '-two\n+TWO', removed: 1, added: 1 },
  ],
}

afterEach(cleanup)

function setup() {
  const onApply = vi.fn()
  const onCancel = vi.fn()
  const utils = render(() => (
    <PreapplyReview
      title="Review before applying: src/App.tsx"
      review={review}
      onApply={onApply}
      onCancel={onCancel}
    />
  ))
  return { onApply, onCancel, ...utils }
}

describe('PreapplyReview', () => {
  it('starts with every hunk approved and shows the diff', () => {
    const { getAllByRole, getByText, container } = setup()

    expect(getAllByRole<HTMLInputElement>('checkbox').map((box) => box.checked)).toEqual([
      true,
      true,
    ])
    expect(getByText('Apply 2 of 2')).toBeTruthy()
    expect(getByText('Hunk 1 · -1 / +1')).toBeTruthy()
    expect(container.querySelectorAll('.diff-added')).toHaveLength(2)
    expect(container.querySelectorAll('.diff-removed')).toHaveLength(2)
  })

  it('sends only the hunks that stay checked', () => {
    const { getAllByRole, getByText, onApply } = setup()
    const boxes = getAllByRole<HTMLInputElement>('checkbox')

    fireEvent.click(boxes[0]!)
    expect(getByText('Apply 1 of 2')).toBeTruthy()

    fireEvent.click(getByText('Apply 1 of 2'))
    expect(onApply).toHaveBeenCalledWith([1])
  })

  it('will not apply an empty selection, but can deny everything', () => {
    const { getAllByRole, getByText, onApply, onCancel } = setup()
    for (const box of getAllByRole<HTMLInputElement>('checkbox')) fireEvent.click(box)

    const apply = getByText('Apply 0 of 2')
    expect(apply.hasAttribute('disabled')).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(getByText('Deny all'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('toggles a hunk back on', () => {
    const { getAllByRole, getByText, onApply } = setup()
    const boxes = getAllByRole<HTMLInputElement>('checkbox')

    fireEvent.click(boxes[1]!)
    fireEvent.click(boxes[1]!)
    fireEvent.click(getByText('Apply 2 of 2'))

    expect(onApply).toHaveBeenCalledWith([0, 1])
  })
})
