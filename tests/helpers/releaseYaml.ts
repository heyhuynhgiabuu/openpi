/**
 * Read `.github/workflows/release.yml` for the release-gate tests.
 *
 * Regexes over the workflow text kept matching SPELLINGS instead of meaning: `actions: write #
 * cache`, `packages: 'write'`, a quoted `'write-all'`, an inline `permissions: { contents: write }`
 * each re-granted a write token while a text counter stayed green. Reading scopes as values fixed
 * those. Then four review rounds found the next layer: quoted keys, `? permissions` complex keys,
 * flow-style `job: { ... }`, and an `if:` value continued across a blank line. Every one kept the
 * suite green while granting write or restoring the fail-open that issue #84 is about.
 *
 * **Fails closed by WHITELIST, not by enumerating bad forms.** An earlier version threw only on the
 * odd shapes it had thought of, and its cross-check compared "keys seen by regex" against "blocks
 * parsed" — two sides sharing one blind spot, so they agreed on zero and passed. The rule is now
 * inverted: every structural line must be a plain unquoted `key: value` mapping line, with no flow
 * collection, no complex key, no anchor. Anything else is rejected BEFORE it is interpreted. That is
 * an invariant rather than a guess: if every line has exactly one possible reading, this reader's
 * reading is the only one, and a form it cannot model becomes a red CI run instead of a green check
 * that vouches for nothing.
 *
 * No YAML dependency, deliberately: none is declared, and adding one means regenerating both
 * lockfiles (`tests/lockfileSkew.test.ts` avoids importing the transitive copy for the same reason).
 */

/** A job's own view of the workflow: its text and the permissions it declares. */
export interface ReleaseJob {
  id: string
  /** The job header through to the line before the next job, verbatim. */
  raw: string
  /** Scopes the job declares, or null when it declares no `permissions:` key at all. */
  permissions: Record<string, string> | null
}

export interface ReleaseWorkflow {
  topLevelPermissions: Record<string, string> | null
  jobs: ReleaseJob[]
}

/** Values a scope may take. Anything else means this reader does not understand the file. */
const SCOPE_VALUES = new Set(['read', 'write', 'none', 'read-all', 'write-all'])

/**
 * The only structural line shape accepted: a plain unquoted `key: value` mapping entry, at one of
 * the indents this file uses for structure. Block-scalar bodies sit deeper than their key, so they
 * never reach this check.
 */
const STRUCTURAL_KEY = /^ {0,4}([A-Za-z_][A-Za-z0-9_-]*)\s*:(\s.*)?$/

function reject(detail: string): never {
  throw new Error(
    `tests/helpers/releaseYaml.ts cannot read release.yml: ${detail}. ` +
      'This reader fails closed on purpose: teach it the construct rather than weakening the check.'
  )
}

/**
 * Reject any structural line whose YAML reading this reader does not model.
 *
 * Shape-based on purpose. A quoted key, a `? key` complex key and a `job: { ... }` flow mapping all
 * read as ordinary entries to a real parser, and each of them slipped a write grant past the text
 * checks; here they fail the shape before anything interprets them.
 */
function assertPlainMappings(text: string): void {
  let inBlockScalar = false
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (inBlockScalar) {
      // A block scalar's body is free text; it ends at the first line indented 4 or less.
      if (indent > 4) continue
      inBlockScalar = false
    }
    if (indent > 4) continue
    const match = line.match(STRUCTURAL_KEY)
    if (!match) reject(`structural line is not a plain "key: value" (${line.trim()})`)
    const value = (match[2] ?? '').trim()
    // The EMPTY flow collections are unambiguous -- `{}` and `[]` cannot carry a scope -- so they
    // stay allowed (`steps: []`, `permissions: {}`). A non-empty one has contents this reader would
    // have to interpret, so it is rejected.
    const emptyFlow = value === '{}' || value === '[]'
    if (!emptyFlow && (value.startsWith('{') || value.startsWith('['))) {
      reject(`flow collection at a structural indent (${line.trim()})`)
    }
    if (/^[&*]/.test(value)) reject(`anchor or alias at a structural indent (${line.trim()})`)
    // `run: |` and friends open a block scalar whose body must not be read as structure.
    if (/^[|>][-+]?\s*(#.*)?$/.test(value)) inBlockScalar = true
  }
}

/** Scopes whose value grants write access. */
function isWrite(value: string): boolean {
  return value === 'write' || value === 'write-all'
}

/**
 * Strip a trailing comment and surrounding quotes from a scalar.
 *
 * The comment may follow a space or sit straight after the colon (`permissions: # note`), and an
 * empty `{}` is a legitimate tightening -- rejecting it turned CI red for a change that REMOVES
 * access, which is how a check earns being weakened later.
 */
function clean(value: string): string {
  const stripped = value
    .replace(/\s*#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
  if (/[&*]/.test(stripped)) reject(`anchor or alias in a permissions value (${value.trim()})`)
  return stripped
}

/** Every scope value must be one this reader understands; unknown values fail closed. */
function validate(scopes: Record<string, string>): Record<string, string> {
  for (const [scope, value] of Object.entries(scopes)) {
    if (!SCOPE_VALUES.has(value)) reject(`unknown value '${value}' for scope '${scope}'`)
  }
  return scopes
}

/** Read `key: value` pairs out of indented block lines, or an inline `{...}` mapping. */
function readScopes(inline: string, children: string[]): Record<string, string> {
  const scopes: Record<string, string> = {}
  const flow = clean(inline)
  if (flow === '{}') return {}
  // `permissions: write-all` sets EVERY scope. Recorded under `*` so it compares unequal to any
  // concrete grant; reading it as "no scopes declared" was the opposite of what it grants.
  if (flow === 'write-all' || flow === 'read-all') return { '*': flow }
  if (flow.startsWith('{')) {
    if (!flow.endsWith('}')) reject(`multi-line inline permissions map (${flow})`)
    for (const entry of flow.replace(/^\{|\}$/g, '').split(',')) {
      const [key, value] = entry.split(':')
      if (!key?.trim() || !value) reject(`malformed inline permissions entry (${entry})`)
      scopes[clean(key)] = clean(value)
    }
    return validate(scopes)
  }
  // Anything else non-empty is a form this reader does not model -- a continuation line, a tag, a
  // quoted scalar. Guessing here is how a write grant goes unnoticed.
  if (flow !== '') reject(`unrecognised permissions value (${flow})`)
  for (const line of children) {
    const match = line.match(/^\s+([\w-]+)\s*:\s*(.*)$/)
    if (!match?.[1]) reject(`unrecognised line in a permissions block (${line.trim()})`)
    scopes[clean(match[1])] = clean(match[2] ?? '')
  }
  return validate(scopes)
}

/** Find a `permissions:` key at exactly `indent` spaces and read the scopes it declares. */
function permissionsAt(lines: string[], indent: number): Record<string, string> | null {
  const head = new RegExp(`^ {${indent}}permissions:\\s*(.*)$`)
  const hits = lines.filter((line) => head.test(line))
  if (hits.length > 1) reject(`more than one permissions: key at ${indent} spaces of indent`)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(head)
    if (!match) continue
    const children: string[] = []
    for (const line of lines.slice(index + 1)) {
      // A comment does not end a block; stopping at one read the scopes after it as empty.
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue
      if (!line.startsWith(' '.repeat(indent + 1))) break
      children.push(line)
    }
    return readScopes(match[1] ?? '', children)
  }
  return null
}

export function parseReleaseWorkflow(text: string): ReleaseWorkflow {
  assertPlainMappings(text)

  const jobsAt = text.search(/^jobs:\s*(#.*)?$/m)
  const preamble = jobsAt === -1 ? text : text.slice(0, jobsAt)
  const body = jobsAt === -1 ? '' : text.slice(jobsAt)

  const jobs: ReleaseJob[] = []
  const header = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/
  let current: { id: string; lines: string[] } | null = null
  for (const line of body.split('\n')) {
    const match = line.match(header)
    if (match?.[1]) {
      if (current) pushJob(jobs, current)
      current = { id: match[1], lines: [line] }
      continue
    }
    current?.lines.push(line)
  }
  if (current) pushJob(jobs, current)

  return { topLevelPermissions: permissionsAt(preamble.split('\n'), 0), jobs }
}

function pushJob(jobs: ReleaseJob[], job: { id: string; lines: string[] }): void {
  // The first `jobs:` match is the key itself, not a job.
  if (job.id === 'jobs') return
  jobs.push({ id: job.id, raw: job.lines.join('\n'), permissions: permissionsAt(job.lines, 4) })
}

/**
 * Every scope in the file that grants write, as `job/scope` (`workflow/scope` at top level).
 *
 * The security property #85 is about, stated once: this list must be exactly `['publish/contents']`.
 */
export function writeGrants(workflow: ReleaseWorkflow): string[] {
  const grants: string[] = []
  for (const [scope, value] of Object.entries(workflow.topLevelPermissions ?? {})) {
    if (isWrite(value)) grants.push(`workflow/${scope}`)
  }
  for (const job of workflow.jobs) {
    for (const [scope, value] of Object.entries(job.permissions ?? {})) {
      if (isWrite(value)) grants.push(`${job.id}/${scope}`)
    }
  }
  return grants
}

/** A job by id, or a failure that names what was looked for. */
export function job(workflow: ReleaseWorkflow, id: string): ReleaseJob {
  const found = workflow.jobs.find((candidate) => candidate.id === id)
  if (!found) {
    throw new Error(
      `release.yml has no job '${id}' (found: ${workflow.jobs.map((j) => j.id).join(', ')})`
    )
  }
  return found
}

/** Lines at job-key indent, so a continuation can be spotted without guessing its content. */
function isJobKeyLine(line: string): boolean {
  return /^ {4}[A-Za-z_]/.test(line)
}

/**
 * The job-level `if:` expression, without the `if:` prefix.
 *
 * A more-indented next line CONTINUES a plain YAML scalar -- blank lines and comments included --
 * so `if: ${{ ... }}`, a blank line, then `  || true` really is `${{ ... }} || true`. Trailing text
 * outside `${{ }}` makes the condition a non-empty string, which GitHub treats as true. Reading only
 * the line after `if:` returned the safe-looking first half.
 */
export function jobCondition(target: ReleaseJob): string {
  const lines = target.raw.split('\n')
  const at = lines.findIndex((line) => /^ {4}if:/.test(line))
  if (at === -1) return ''
  const match = lines[at]?.match(/^ {4}if:\s*(.*)$/)
  if (!match) reject('a job-level `if:` this reader cannot parse')
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (isJobKeyLine(line)) break
    reject(`a continuation line after the job-level if: (${line.trim()})`)
  }
  return (match[1] ?? '').trim()
}
