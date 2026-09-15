import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { GitHunkActions } from '../src/components/git/GitHunkActions'
import type { GitFileDiff } from '../src/lib/ipc'

/** Two hunks, the first of which removes a markdown rule (content `--- `). */
const RAW_PATCH = [
  'diff --git a/README.md b/README.md',
  'index 1111111..2222222 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,5 +1,4 @@',
  ' title',
  '',
  '---- ',
  '-old line',
  '+new line',
  ' after',
  '@@ -10,3 +9,3 @@',
  '-second hunk out',
  '+second hunk in',
  ' tail',
].join('\n')

const diff: GitFileDiff = {
  path: 'README.md',
  rawPatch: RAW_PATCH,
  totalAdded: 2,
  totalRemoved: 3,
  isNew: false,
  isDeleted: false,
}

const noop = () => undefined

function renderActions() {
  return render(() => (
    <GitHunkActions
      diff={diff}
      scope="unstaged"
      onStageFile={noop}
      onUnstageFile={noop}
      onRevertFile={noop}
      onStageHunk={noop}
      onUnstageHunk={noop}
      onRevertHunk={noop}
      isStaged={false}
    />
  ))
}

afterEach(cleanup)

describe('GitHunkActions per-hunk counts', () => {
  /** One entry per rendered hunk row, in display order. */
  const rowCounts = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('.git-hunk-item')].map(
      (row) => row.querySelector('.git-hunk-lines-count')?.textContent ?? ''
    )

  it('counts a removed markdown rule in the hunk that contains it', () => {
    const { getByTitle, container } = renderActions()

    fireEvent.click(getByTitle('Expand hunks'))

    // Read per row: a swapped pairing of hunks and counts would still satisfy a
    // text-only query, and the sum below is order-independent.
    // First hunk: `---- ` is content `--- `, so it counts like `-old line`.
    expect(rowCounts(container)).toEqual(['+1/-2', '+1/-1'])
  })

  it('adds up to the totals the pane header shows', () => {
    const { getByTitle, container } = renderActions()

    fireEvent.click(getByTitle('Expand hunks'))

    const sums = rowCounts(container).reduce(
      (total, text) => {
        const [added, removed] = text.replace('+', '').split('/-').map(Number)
        return { added: total.added + added, removed: total.removed + removed }
      },
      { added: 0, removed: 0 }
    )

    expect(sums).toEqual({ added: diff.totalAdded, removed: diff.totalRemoved })
  })
})
