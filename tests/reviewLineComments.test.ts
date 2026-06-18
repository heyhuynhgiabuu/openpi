import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import {
  normalizeRange,
  sanitizeReviewLineRange,
  useReviewLineComments,
} from '../src/hooks/useReviewLineComments'
import type { FileLineComment, NewFileLineComment } from '../src/lib/fileLineComments'

describe('review line comment ranges', () => {
  it('keeps same-side multi-line ranges intact', () => {
    expect(sanitizeReviewLineRange({ start: 4, end: 8, side: 'additions' })).toEqual({
      start: 4,
      end: 8,
      side: 'additions',
    })
  })

  it('collapses mixed deletion/addition ranges to the anchor line', () => {
    expect(
      sanitizeReviewLineRange({ start: 4, end: 5, side: 'deletions', endSide: 'additions' })
    ).toEqual({
      start: 4,
      end: 4,
      side: 'deletions',
    })
  })

  it('normalizes mixed ranges as single-side anchor selections', () => {
    expect(normalizeRange({ start: 4, end: 5, side: 'deletions', endSide: 'additions' })).toEqual({
      start: 4,
      end: 4,
      side: 'deletions',
    })
  })

  it('tracks updated comments from the parent store', () => {
    createRoot((dispose) => {
      const [comments, setComments] = createSignal<FileLineComment[]>([])
      const controller = useReviewLineComments({
        filePath: 'src/App.tsx',
        fileContent: () => null,
        comments,
        onAdd: () => {},
        onRemove: () => {},
      })

      expect(controller.annotations()).toEqual([])
      setComments([
        {
          id: 'comment-1',
          path: 'src/App.tsx',
          startLine: 4,
          endLine: 5,
          side: 'additions',
          source: 'review',
          comment: 'Looks wrong',
          snippet: 'const value = 1',
        },
      ])
      expect(controller.annotations()).toHaveLength(2)
      dispose()
    })
  })

  it('uses file content loaded after selection when saving a draft', () => {
    createRoot((dispose) => {
      const [fileContent, setFileContent] = createSignal<string | null>(null)
      const saved: NewFileLineComment[] = []
      const controller = useReviewLineComments({
        filePath: 'src/App.tsx',
        fileContent,
        comments: () => [],
        onAdd: (comment) => {
          saved.push(comment)
        },
        onRemove: () => {},
      })

      controller.handleLineSelected({ start: 2, end: 3, side: 'additions' })
      setFileContent('line one\nline two\nline three\nline four')
      controller.saveDraft('Please check this')

      expect(saved[0]?.snippet).toBe('line two\nline three')
      dispose()
    })
  })
})
