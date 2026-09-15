/**
 * fffRanges.ts — Range convention for search highlights.
 *
 * `@ff-labs/fff-node` reports byte offsets into the line with an exclusive end
 * (`abc 123 def` → `[[4, 7]]` for `123`). The renderer highlights inclusive
 * character indices — `HighlightedText` slices `[start, end + 1]`, and the
 * file-name search produces `[index, index + length - 1]` — so content-search
 * results are converted before they cross IPC. Without this, a line with
 * non-ASCII text before the match highlights the wrong span, and every match
 * highlights one character too many.
 *
 * The mapping assumes the line decoded from the same bytes the offsets point
 * into, which holds except for invalid UTF-8: there the native decoder emits
 * one U+FFFD per invalid byte, and this treats it as the single byte it was.
 */

/** Convert a byte-offset range into an inclusive character range. */
export function byteRangeToInclusiveChars(
  line: string,
  range: readonly [number, number]
): [number, number] {
  const [byteStart, byteEnd] = range
  let byteOffset = 0
  let charOffset = 0
  let start = -1
  let end = -1

  for (const char of line) {
    const nextByteOffset = byteOffset + utf8Length(char)
    if (start < 0 && byteStart < nextByteOffset) start = charOffset
    // The byte end is exclusive, so this is the last code unit the range covers.
    if (end < 0 && byteEnd <= nextByteOffset) end = charOffset + char.length - 1
    byteOffset = nextByteOffset
    charOffset += char.length
    if (start >= 0 && end >= 0) break
  }

  // A range that starts past the line, or ends inside its last character,
  // clamps to the line rather than producing an inverted span.
  const charStart = start < 0 ? line.length : start
  const charEnd = end < 0 ? line.length - 1 : end
  return [charStart, Math.max(charStart, charEnd)]
}

function utf8Length(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0
  // The native library decodes the line lossily but reports byte offsets into
  // the file, so an invalid byte arrives as U+FFFD and occupies one byte there.
  if (codePoint === 0xfffd) return 1
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}
