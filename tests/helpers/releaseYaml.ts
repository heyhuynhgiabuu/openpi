/**
 * Read `.github/workflows/release.yml`'s permission blocks for the release gate tests.
 *
 * Regexes over the workflow text kept missing spellings rather than intent: a scope written
 * `actions: write # cache`, `packages: 'write'` or `write-all` re-granted a write token to every
 * build leg while a `/^\s*[a-z-]+: write$/m` counter stayed green. So read the *scopes* and compare
 * values, and indentation and comments stop mattering.
 *
 * No YAML dependency: `yaml` is transitive here only (`tests/lockfileSkew.test.ts` avoids it for
 * the same reason), and adding one would need both lockfiles regenerated.
 *
 * **This reader fails closed.** It understands only the block mappings this file uses, and THROWS
 * on anything else — a quoted scope value, an anchor, a duplicate `permissions:` key, a wrapped
 * `if:`, a `permissions` key the parse never accounted for. A hand-rolled reader cannot be proven
 * equivalent to GitHub's, and the dangerous direction is under-detecting write. Throwing turns a
 * blind spot into a red CI run a human looks at, instead of a green check that vouches for nothing.
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

/** Scopes whose value grants write access. */
function isWrite(value: string): boolean {
  return value === 'write' || value === 'write-all'
}

/** Values a scope may take. Anything else means this reader does not understand the file. */
const SCOPE_VALUES = new Set(['read', 'write', 'none', 'read-all', 'write-all'])

function reject(detail: string): never {
  throw new Error(
    `tests/helpers/releaseYaml.ts cannot read release.yml: ${detail}. ` +
      'This reader fails closed on purpose: teach it the construct rather than weakening the check.'
  )
}

/** Strip a trailing comment and surrounding quotes from a scalar. */
function clean(value: string): string {
  const stripped = value
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
  // Anchors and aliases would make the same permissions reachable under a name this reader
  // never resolves, so the scopes would silently read as empty.
  if (/[&*]/.test(stripped)) reject(`anchor or alias in a permissions value (${value.trim()})`)
  return stripped
}

/** Read `key: value` pairs out of indented block lines, or an inline `{...}` mapping. */
function readScopes(inline: string, children: string[]): Record<string, string> {
  const scopes: Record<string, string> = {}
  const flow = clean(inline)
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
  // Anything else non-empty is a form this reader does not model -- a continuation line, a tag,
  // a quoted scalar. Guessing here is how a write grant goes unnoticed.
  if (flow !== '') reject(`unrecognised permissions value (${flow})`)
  for (const line of children) {
    const match = line.match(/^\s+([\w-]+)\s*:\s*(.*)$/)
    if (!match?.[1]) reject(`unrecognised line in a permissions block (${line.trim()})`)
    scopes[clean(match[1])] = clean(match[2] ?? '')
  }
  return validate(scopes)
}

/** Every scope value must be one this reader understands; unknown values fail closed. */
function validate(scopes: Record<string, string>): Record<string, string> {
  for (const [scope, value] of Object.entries(scopes)) {
    if (!SCOPE_VALUES.has(value)) reject(`unknown value '${value}' for scope '${scope}'`)
  }
  return scopes
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
      // A comment does not end a block; stopping at one would read the scopes after it as empty.
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue
      if (!line.startsWith(' '.repeat(indent + 1))) break
      children.push(line)
    }
    return readScopes(match[1] ?? '', children)
  }
  return null
}

export function parseReleaseWorkflow(text: string): ReleaseWorkflow {
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

  const parsed: ReleaseWorkflow = {
    topLevelPermissions: permissionsAt(preamble.split('\n'), 0),
    jobs,
  }
  // Cross-check: every `permissions` key in the text must have been accounted for by the parse.
  // Without this, a block the reader never visited is a grant it silently did not see.
  const declared = (text.match(/^\s*permissions\s*:/gm) ?? []).length
  const parsedCount =
    (parsed.topLevelPermissions === null ? 0 : 1) +
    jobs.filter((entry) => entry.permissions !== null).length
  if (declared !== parsedCount) {
    reject(`${declared} permissions: key(s) in the file but only ${parsedCount} were parsed`)
  }
  return parsed
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

/**
 * The job-level `if:` expression, without the `if:` prefix.
 *
 * A more-indented next line CONTINUES a plain YAML scalar, so
 * `if: ${{ ... }}` followed by `  || true` really is `${{ ... }} || true` -- trailing text outside
 * `${{ }}` makes the condition a non-empty string, which GitHub treats as true. Returning only the
 * first line read that as the safe form, so a continuation is rejected rather than ignored.
 */
export function jobCondition(target: ReleaseJob): string {
  const lines = target.raw.split('\n')
  const at = lines.findIndex((line) => /^ {4}if:/.test(line))
  if (at === -1) return ''
  const match = lines[at]?.match(/^ {4}if:\s*(.*)$/)
  if (!match) reject('a job-level `if:` this reader cannot parse')
  const next = lines[at + 1] ?? ''
  if (next.trim() !== '' && !next.trimStart().startsWith('#') && /^ {5,}/.test(next)) {
    reject(`a continuation line after the job-level if: (${next.trim()})`)
  }
  return (match[1] ?? '').trim()
}
