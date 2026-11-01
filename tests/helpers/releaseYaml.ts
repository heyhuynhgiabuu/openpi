/**
 * Just enough YAML reading to hold `.github/workflows/release.yml` to its permission rules.
 *
 * Regexes over the workflow text kept missing spellings rather than missing intent: a scope
 * written `actions: write # cache` or `'write'` re-granted a write token to every build leg while
 * a `/^\s*[a-z-]+: write$/m` counter stayed green. The fix is to read the *scopes* and compare
 * values, so indentation and comments stop mattering and only the granted privilege does.
 *
 * Deliberately not a YAML parser: no dependency is added for a test, and the file uses only
 * block mappings at fixed indentation. The one assumption is that a line at exactly two spaces
 * is a job id -- block scalars inside steps are indented past their key, which is at six spaces
 * or deeper, so they cannot collide.
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

/** Scopes whose value grants write access, however it is spelled. */
function isWrite(value: string): boolean {
  return value === 'write' || value === 'write-all'
}

/** Strip a trailing comment and surrounding quotes from a scalar. */
function clean(value: string): string {
  return value
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

/** Read `key: value` pairs out of indented block lines, or an inline `{...}` mapping. */
function readScopes(inline: string, children: string[]): Record<string, string> {
  const scopes: Record<string, string> = {}
  const flow = inline.replace(/\s+#.*$/, '').trim()
  // `permissions: write-all` sets EVERY scope to write. Recorded under `*` so it compares unequal
  // to any concrete grant instead of reading as an empty map -- the earlier version treated this
  // as "no scopes declared", which is the opposite of what it grants.
  if (flow === 'write-all' || flow === 'read-all') return { '*': flow }
  if (flow.startsWith('{')) {
    for (const entry of flow.replace(/^\{|\}$/g, '').split(',')) {
      const [key, value] = entry.split(':')
      if (key?.trim() && value) scopes[key.trim()] = clean(value)
    }
    return scopes
  }
  for (const line of children) {
    const match = line.match(/^\s+([\w-]+):\s*(.*)$/)
    if (match?.[1]) scopes[match[1]] = clean(match[2] ?? '')
  }
  return scopes
}

/** Find a `permissions:` key at exactly `indent` spaces and read the scopes it declares. */
function permissionsAt(lines: string[], indent: number): Record<string, string> | null {
  const head = new RegExp(`^ {${indent}}permissions:\\s*(.*)$`)
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(head)
    if (!match) continue
    const children: string[] = []
    for (const line of lines.slice(index + 1)) {
      if (line.trim() === '') continue
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
      if (current) jobs.push(...toJob(current))
      current = { id: match[1], lines: [line] }
      continue
    }
    current?.lines.push(line)
  }
  if (current) jobs.push(...toJob(current))

  return { topLevelPermissions: permissionsAt(preamble.split('\n'), 0), jobs }
}

function toJob(job: { id: string; lines: string[] }): ReleaseJob[] {
  // The first line is the `jobs:` key itself when it matched the header shape; skip it.
  if (job.id === 'jobs') return []
  return [{ id: job.id, raw: job.lines.join('\n'), permissions: permissionsAt(job.lines, 4) }]
}

/**
 * Every scope in the file that grants write, as `job/scope` (`workflow/scope` at top level).
 *
 * The security property #85 is about, stated once: this list must be exactly `['publish/contents']`.
 * Reading values instead of counting lines means a trailing comment, a quoted value, a
 * `write-all`, or an extra scope cannot slip past.
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
  if (!found)
    throw new Error(
      `release.yml has no job '${id}' (found: ${workflow.jobs.map((j) => j.id).join(', ')})`
    )
  return found
}

/** The job-level `if:` expression, without the `if:` prefix. */
export function jobCondition(target: ReleaseJob): string {
  const match = target.raw.match(/^ {4}if:\s*(.*)$/m)
  return (match?.[1] ?? '').trim()
}
