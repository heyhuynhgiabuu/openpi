import { describe, expect, it } from 'vitest'
import { createOutputCleaner } from '../electron/pi/durable/ansi'

/** Phase 8.3n: output cleaning must give the same text however the chunks are cut. */

const ESC = '\u001b'
const BEL = '\u0007'

/** Feed `text` to a cleaner cut into pieces at every position, in every two-way split. */
function cleanedAt(text: string, cut: number): string {
  const cleaner = createOutputCleaner()
  return cleaner.clean(text.slice(0, cut)) + cleaner.clean(text.slice(cut)) + cleaner.flush()
}

describe('output cleaner', () => {
  const samples: [string, string][] = [
    ['colour', `${ESC}[31mred${ESC}[0m ok`],
    ['title ended by BEL', `${ESC}]0;private-title${BEL}visible`],
    ['title ended by ST', `${ESC}]0;private-title${ESC}\\visible`],
    ['hyperlink', `${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL} after`],
    ['carriage returns', 'a\r\nb\r\n'],
  ]
  const expected: Record<string, string> = {
    colour: 'red ok',
    'title ended by BEL': 'visible',
    'title ended by ST': 'visible',
    hyperlink: 'link after',
    'carriage returns': 'a\nb\n',
  }

  it.each(samples)('%s is identical wherever the chunk boundary falls', (name, text) => {
    for (let cut = 0; cut <= text.length; cut += 1) {
      expect(cleanedAt(text, cut), `cut at ${cut}`).toBe(expected[name])
    }
  })

  it('lets an escape that never finishes through instead of holding output forever', () => {
    const cleaner = createOutputCleaner()
    // Without `flush()`: the text must come out while the stream is still going.
    expect(cleaner.clean(`${ESC}]0;${'x'.repeat(5000)}`).length).toBeGreaterThan(0)
  })

  it('leaves plain text alone', () => {
    const cleaner = createOutputCleaner()
    expect(cleaner.clean('plain text\n') + cleaner.flush()).toBe('plain text\n')
  })
})
