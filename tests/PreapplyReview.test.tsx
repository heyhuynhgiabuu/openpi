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
  const utils = render(() => (
    <PreapplyReview title="Review before applying: src/App.tsx" review={review} onApply={onApply} />
  ))
  return { onApply, ...utils }
}

/** Hunk checkboxes only: the footer carries a separate "remember" checkbox. */
function hunkBoxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('.preapply-hunk input[type="checkbox"]')]
}

describe('PreapplyReview', () => {
  it('starts with every hunk approved and shows the diff', () => {
    const { getByText, container } = setup()

    expect(hunkBoxes(container).map((box) => box.checked)).toEqual([true, true])
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
    expect(onApply).toHaveBeenCalledWith([1], false)
  })

  it('denies through the same answer as an approval', () => {
    const { getByText, onApply, container, getByLabelText } = setup()
    for (const box of hunkBoxes(container)) fireEvent.click(box)

    const apply = getByText('Apply 0 of 2')
    expect(apply.hasAttribute('disabled')).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()

    // Nothing selected means there is nothing to skip reviewing later.
    expect(getByLabelText('Skip review for the rest of this turn').hasAttribute('disabled')).toBe(
      true
    )

    fireEvent.click(getByText('Deny all'))
    expect(onApply).toHaveBeenCalledWith([], false)
  })

  it('can skip review for the rest of the turn', () => {
    const { getByLabelText, getByText, onApply } = setup()

    fireEvent.click(getByLabelText('Skip review for the rest of this turn'))
    fireEvent.click(getByText('Apply 2 of 2'))

    expect(onApply).toHaveBeenCalledWith([0, 1], true)
  })

  it('toggles a hunk back on', () => {
    const { getAllByRole, getByText, onApply } = setup()
    const boxes = getAllByRole<HTMLInputElement>('checkbox')

    fireEvent.click(boxes[1]!)
    fireEvent.click(boxes[1]!)
    fireEvent.click(getByText('Apply 2 of 2'))

    expect(onApply).toHaveBeenCalledWith([0, 1], false)
  })
})
