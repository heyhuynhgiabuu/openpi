import { stripVTControlCharacters } from 'node:util'

/**
 * Terminal escape sequences cut by the end of an output chunk.
 *
 * Output arrives in arbitrary chunks, and stripping each chunk on its own leaves the tail of a
 * sequence that was split across two (`[31m`, or the text of a window title). So the end of a chunk
 * that opens a sequence it does not finish is held back and prepended to the next chunk.
 */

const ESC = '\u001b'
const BEL = '\u0007'
/** `ESC ]` (OSC), `ESC P` (DCS), `ESC X` (SOS), `ESC ^` (PM), `ESC _` (APC): run to BEL or `ESC \`. */
const STRING_KINDS = ']PX^_'
/** A held-back sequence longer than this is never going to finish; let it through. */
const MAX_PENDING = 4096

/** Index just past the sequence opening at `at`, or -1 when `text` ends before it does. */
function escapeEnd(text: string, at: number): number {
  const kind = text[at + 1]
  if (kind === undefined) return -1
  if (kind === '[') {
    let index = at + 2
    while (index < text.length && /[0-9;?]/.test(text[index] ?? '')) index += 1
    while (index < text.length && /[ -/]/.test(text[index] ?? '')) index += 1
    if (index >= text.length) return -1
    // A byte that cannot continue a CSI sequence ends it as malformed; stripping handles the rest.
    return index + 1
  }
  if (STRING_KINDS.includes(kind)) {
    const bell = text.indexOf(BEL, at + 2)
    const terminator = text.indexOf(`${ESC}\\`, at + 2)
    if (bell === -1 && terminator === -1) return -1
    if (terminator === -1 || (bell !== -1 && bell < terminator)) return bell + 1
    return terminator + 2
  }
  return at + 2
}

export function splitIncompleteEscape(text: string): { complete: string; pending: string } {
  let at = text.indexOf(ESC)
  while (at !== -1) {
    const end = escapeEnd(text, at)
    if (end === -1) {
      const pending = text.slice(at)
      if (pending.length > MAX_PENDING) return { complete: text, pending: '' }
      return { complete: text.slice(0, at), pending }
    }
    at = text.indexOf(ESC, end)
  }
  return { complete: text, pending: '' }
}

/** Strips escape sequences and carriage returns from a stream of chunks, however they are split. */
export function createOutputCleaner(): {
  clean: (chunk: string) => string
  flush: () => string
} {
  let pending = ''
  const strip = (text: string): string => stripVTControlCharacters(text).replace(/\r/g, '')
  return {
    clean(chunk) {
      const split = splitIncompleteEscape(pending + chunk)
      pending = split.pending
      return strip(split.complete)
    },
    flush() {
      const rest = pending
      pending = ''
      return strip(rest)
    },
  }
}
