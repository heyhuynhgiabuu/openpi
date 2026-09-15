import { describe, expect, it } from 'vitest'
import { countContentLines, countDiffLines } from '../electron/git/gitDiffCount'

describe('countContentLines', () => {
  it('counts a file without a trailing newline', () => {
    expect(countContentLines('one')).toBe(1)
    expect(countContentLines('one\ntwo')).toBe(2)
  })

  it('does not count the empty string after a trailing newline', () => {
    expect(countContentLines('one\n')).toBe(1)
    expect(countContentLines('one\ntwo\n')).toBe(2)
    expect(countContentLines('\n')).toBe(1)
  })

  it('counts blank lines inside the file', () => {
    expect(countContentLines('one\n\ntwo\n')).toBe(3)
    expect(countContentLines('one\n\n')).toBe(2)
  })

  it('handles CRLF', () => {
    expect(countContentLines('one\r\ntwo\r\n')).toBe(2)
    expect(countContentLines('\r\n')).toBe(1)
  })

  it('returns zero for empty contents', () => {
    expect(countContentLines('')).toBe(0)
  })
})

describe('countDiffLines', () => {
  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-removed line',
    '+added line',
    '+another added line',
  ].join('\n')

  it('counts content lines and skips the file headers', () => {
    expect(countDiffLines(patch)).toEqual({ added: 2, removed: 1 })
  })

  it('counts a removed markdown rule, whose diff line starts with four dashes', () => {
    const markdown = ['--- a/README.md', '+++ b/README.md', '@@ -1 +0,0 @@', '----'].join('\n')

    expect(countDiffLines(markdown)).toEqual({ added: 0, removed: 1 })
  })

  it('counts an added line that starts with the header prefix', () => {
    const added = ['--- a/README.md', '+++ b/README.md', '@@ -0,0 +1 @@', '++++ not a header'].join(
      '\n'
    )

    expect(countDiffLines(added)).toEqual({ added: 1, removed: 0 })
  })

  it('ignores hunk headers, modes and rename metadata', () => {
    const meta = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 95%',
      'rename from old.ts',
      'rename to new.ts',
      'new file mode 100644',
      '@@ -1 +1 @@',
      '\\ No newline at end of file',
    ].join('\n')

    expect(countDiffLines(meta)).toEqual({ added: 0, removed: 0 })
  })

  it('counts a whole-file addition', () => {
    const newFile = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n')

    expect(countDiffLines(newFile)).toEqual({ added: 2, removed: 0 })
  })

  it('counts a whole-file deletion', () => {
    const deleted = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n')

    expect(countDiffLines(deleted)).toEqual({ added: 0, removed: 2 })
  })

  it('returns zeroes for an empty patch', () => {
    expect(countDiffLines('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('countDiffLines hunk state', () => {
  it('counts a removed line whose content is exactly the header prefix', () => {
    const patch = [
      'diff --git a/notes.txt b/notes.txt',
      '--- a/notes.txt',
      '+++ b/notes.txt',
      '@@ -1 +0,0 @@',
      '--- ',
    ].join('\n')

    expect(countDiffLines(patch)).toEqual({ added: 0, removed: 1 })
  })

  it('counts an added line whose content is exactly the header prefix', () => {
    const patch = [
      'diff --git a/notes.txt b/notes.txt',
      '--- a/notes.txt',
      '+++ b/notes.txt',
      '@@ -0,0 +1 @@',
      '+++ ',
    ].join('\n')

    expect(countDiffLines(patch)).toEqual({ added: 1, removed: 0 })
  })

  it('stops counting at the next file in a multi-file patch', () => {
    const patch = [
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-old one',
      '+new one',
      'diff --git a/two.ts b/two.ts',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -1 +1 @@',
      '-old two',
      '+new two',
    ].join('\n')

    expect(countDiffLines(patch)).toEqual({ added: 2, removed: 2 })
  })

  it('counts a combined diff by its first column, which is the ours side', () => {
    const combined = [
      'diff --cc src/app.ts',
      'index 1111111,2222222..0000000',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@@ -1,3 -1,3 +1,7 @@@',
      '++<<<<<<< HEAD',
      ' +MAIN',
      '++=======',
      '+ OTHER',
      '++>>>>>>> other',
    ].join('\n')

    // Counting the last column instead would count our side again and double it.
    expect(countDiffLines(combined)).toEqual({ added: 4, removed: 0 })
  })

  it('counts a removal in a combined diff from the first column', () => {
    const combined = [
      'diff --cc src/app.ts',
      '@@@ -1,3 -1,3 +1,3 @@@',
      '- gone in ours',
      '  context',
    ].join('\n')

    expect(countDiffLines(combined)).toEqual({ added: 0, removed: 1 })
  })

  it('does not count a line that only appears on the other side of a conflict', () => {
    // Column 2 is `theirs`; a `+` there means the line is absent from ours, so
    // it is not something we added.
    const combined = [
      'diff --cc src/app.ts',
      '@@@ -1,3 -1,3 +1,4 @@@',
      '  shared',
      ' +only theirs',
      '  more shared',
    ].join('\n')

    expect(countDiffLines(combined)).toEqual({ added: 0, removed: 0 })
  })
})
