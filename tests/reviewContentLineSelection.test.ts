import { afterEach, describe, expect, it } from 'vitest'
import { getReviewContentSelectionPoint } from '../src/components/review/reviewContentLineSelection'

function createPre() {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.setAttribute('data-code', '')
  pre.append(code)
  document.body.append(pre)
  return { pre, code }
}

describe('getReviewContentSelectionPoint', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })
  it('resolves content rows to addition selection points', () => {
    const { pre, code } = createPre()
    const line = document.createElement('span')
    line.setAttribute('data-line', '42')
    line.setAttribute('data-line-index', '9')
    line.setAttribute('data-line-type', 'change-addition')
    code.append(line)

    expect(getReviewContentSelectionPoint([line, code, pre], pre)).toEqual({
      lineNumber: 42,
      lineIndex: 9,
      side: 'additions',
    })
  })

  it('ignores line-number column paths', () => {
    const { pre, code } = createPre()
    const number = document.createElement('span')
    number.setAttribute('data-column-number', '42')
    number.setAttribute('data-line-index', '9')
    code.append(number)

    expect(getReviewContentSelectionPoint([number, code, pre], pre)).toBeNull()
  })

  it('resolves split context rows on the deletions side', () => {
    const { pre, code } = createPre()
    pre.setAttribute('data-diff-type', 'split')
    code.setAttribute('data-deletions', '')
    const line = document.createElement('span')
    line.setAttribute('data-line', '12')
    line.setAttribute('data-line-index', '4,7')
    line.setAttribute('data-line-type', 'context')
    code.append(line)

    expect(getReviewContentSelectionPoint([line, code, pre], pre)).toEqual({
      lineNumber: 12,
      lineIndex: 7,
      side: 'deletions',
    })
  })
})
