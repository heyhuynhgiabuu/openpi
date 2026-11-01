import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { job, jobCondition, parseReleaseWorkflow, writeGrants } from './helpers/releaseYaml'

const root = resolve(import.meta.dirname, '..')

/**
 * The release build runs `npm test` on every matrix leg, including windows-2022, where
 * `bash` may not be on PATH. Executing the validate step is only possible where it is;
 * the static assertions above always run.
 */
function hasBash(): boolean {
  try {
    execSync('bash --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')

/** The build job only: `publish` holds the side effects and is asserted separately. */
function buildJob(): string {
  const start = workflow.indexOf('  build:')
  const end = workflow.indexOf('  publish:')
  if (start < 0 || end < start) throw new Error('Cannot locate the build job in release.yml')
  return workflow.slice(start, end)
}

/**
 * The `Validate release version` step's shell, dedented, between its `run: |` and the
 * next step. Ending on the next `- name:` rather than on a named step keeps a step
 * inserted after Validate inside the check instead of inside the exemption.
 */
function validateScript(build: string): string {
  const start = build.indexOf('- name: Validate release version')
  if (start < 0) throw new Error('Cannot locate the Validate release version step')
  const next = build.indexOf('\n      - name:', start)
  const step = build.slice(start, next < 0 ? undefined : next)
  const runIndex = step.indexOf('run: |')
  if (runIndex < 0) throw new Error('Validate step has no run block')
  return step
    .slice(runIndex + 'run: |'.length)
    .split('\n')
    .filter((line, index, lines) => !(index === 0 && line.trim() === ''))
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
}

/**
 * Render a run block the way GitHub does, then run it under bash with a GITHUB_OUTPUT.
 * `dryRun` is the *rendered text*, not a boolean: a push renders `''` (the `inputs`
 * context is empty), an unchecked dispatch renders `'false'`, and a checked one renders
 * `'true'`. Modelling only the boolean would miss that a real dispatch renders 'false'.
 */
function runValidate(
  script: string,
  values: { dryRun: string; refName: string }
): { status: number; version: string; stderr: string } {
  const rendered = script
    .replaceAll('${{ inputs.dry_run }}', values.dryRun)
    .replaceAll('${{ github.ref_name }}', values.refName)
  expect(rendered).not.toContain('${{')
  return runShell(rendered)
}

function runShell(script: string): { status: number; version: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpi-release-validate-'))
  try {
    const outputPath = join(dir, 'github_output')
    writeFileSync(outputPath, '')
    let status = 0
    let stderr = ''
    try {
      execFileSync('bash', ['-eo', 'pipefail', '-c', script], {
        cwd: root,
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
        stdio: 'pipe',
        encoding: 'utf8',
      })
    } catch (error) {
      status = (error as { status?: number }).status ?? 1
      // `::error::` workflow annotations are written to stdout, not stderr.
      stderr = `${(error as { stderr?: string }).stderr ?? ''}${(error as { stdout?: string }).stdout ?? ''}`
    }
    const output = readFileSync(outputPath, 'utf8')
    const match = /^version=(.*)$/m.exec(output)
    return { status, version: match?.[1] ?? '', stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const packageVersion = (
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
).version

describe('release dry run', () => {
  const parsed = parseReleaseWorkflow(workflow)

  it('publishes only for a real release, never for a dry run and never after a failure', () => {
    const publish = workflow.slice(workflow.indexOf('  publish:'))
    // The whole condition, verbatim, read from the publish job's OWN `if:` -- not from any line
    // between `publish:` and the end of the file, which a later job could satisfy while publish's
    // own condition was weakened. An earlier version matched only `${{ .* }}`, which admits
    // `|| true` or a widened event check: the exact fail-open class #84 is about.
    expect(jobCondition(job(parsed, 'publish'))).toBe(
      "${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/') && inputs.dry_run != true }}"
    )
    // Anchored to the whole job-level line: trailing text outside `${{ }}` would turn the
    // condition into a non-empty string, which GitHub treats as true -- publishing always.
    expect(publish).not.toMatch(/^    if: .*\}\}.*\S$/m)
    // A status function in the condition would both ignore `needs` and disable the
    // implicit success() check, publishing after a failed build.
    expect(publish).not.toMatch(/if:.*(always|failure|cancelled)\(/)
    expect(publish).toContain('needs: build')
  })

  it('refuses to publish unless a tag was pushed, not merely because dry_run is false', () => {
    // The gate used to test only `inputs.dry_run`, which is fail-open: a `workflow_dispatch`
    // with the box left unchecked on ANY branch evaluated true. What stopped it was the tag
    // check in "Validate release version" happening to fail -- incidental, not designed, and
    // one relaxation of that check away from publishing from a branch.
    const publish = workflow.slice(workflow.indexOf('  publish:'))
    const condition = publish.match(/^    if: (.*)$/m)?.[1] ?? ''
    expect(condition).toContain("github.event_name == 'push'")
    expect(condition).toContain("startsWith(github.ref, 'refs/tags/')")
    expect(condition).toContain('inputs.dry_run != true')
    // Every conjunct is required; assert there are exactly three of them so dropping one from
    // the middle is caught too, not just dropping the last.
    expect(condition.split('&&')).toHaveLength(3)
  })

  it('keeps the release permission at the job that needs it, not the whole workflow', () => {
    // Every build leg runs repository code and third-party actions; none of them needs a
    // write-capable GITHUB_TOKEN. Only `publish` does, and only for the release upload --
    // the Homebrew steps use BREW_TAP_TOKEN, which is not GITHUB_TOKEN at all.
    // Deep equality, not a substring: `contents: read` sitting beside an `actions: write` would
    // pass a text check while handing every leg a write token again.
    expect(parsed.topLevelPermissions).toEqual({ contents: 'read' })
    expect(writeGrants(parsed)).toEqual(['publish/contents'])
  })

  it('grants write to the publish job and to nothing else', () => {
    // #85 was `contents: write` at workflow level, where every build leg held it. Scoping it to
    // `publish` is only half the fix: a second job or a second scope could re-add it, and a test
    // that checks "publish has write" alone would not notice.
    // Reading scopes rather than text is what makes `actions: write # cache`, `packages: 'write'`,
    // `write-all`, a trailing space and an inline `permissions: { contents: write }` all count as
    // the same grant instead of each evading a different regex.
    expect(job(parsed, 'publish').permissions).toEqual({ contents: 'write' })
    // Declaring a `permissions:` key on a job REPLACES the workflow default, so a build leg that
    // declares `permissions: {}` is tighter, not looser; what matters is that no other job grants
    // write, and `writeGrants` above covers every job and scope exhaustively.
    expect(parsed.jobs.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['build', 'publish'])
    )
  })

  it('takes a boolean dry_run input', () => {
    const dispatch = workflow.slice(
      workflow.indexOf('workflow_dispatch:'),
      workflow.indexOf('permissions:')
    )
    // `type: boolean` is load-bearing, not cosmetic. As a string input, GitHub compares
    // 'true' with the boolean in the publish condition by coercing both to numbers
    // (NaN vs 1), so `inputs.dry_run != true` is TRUE and a dry run would publish.
    expect(dispatch).toMatch(/dry_run:[\s\S]*?type: boolean/)
    expect(dispatch).toContain('- "main"')
  })

  it('resolves the release version from metadata in every build step', () => {
    // A build step that derives the version from the ref resolves release/main/ on a dry
    // run, a directory electron-builder never writes. Rather than banning spellings, hold
    // the whole build job to an allowlist: exactly three legitimate reads of the ref -- the
    // Validate step translating a tag into the metadata version, a human-readable checksum
    // header, and the artifact name. Anything else that reaches for the ref --
    // ${{ github.ref }}, GITHUB_REF, GITHUB_REF_NAME, a single-quoted or unspaced variant,
    // an intermediate TAG variable, a `sed` invocation -- is a new line and fails here.
    const build = buildJob()
    const refLines = build
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /github\.ref|GITHUB_REF/.test(line))
    expect(refLines).toEqual([
      'VERSION="${{ github.ref_name }}"',
      'echo "# SHA-256 checksums for OpenPi ${{ github.ref_name }} (${{ matrix.name }})" > "$CHECKSUMS_FILE"',
      'name: openpi-${{ matrix.name }}-${{ github.ref_name }}',
    ])
    const resolveOutput = 'VERSION="${{ steps.release_meta.outputs.version }}"'
    const versionAssignments = build
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^VERSION=/.test(line))
    // Every assignment is one of: the resolved metadata output (what build steps must
    // use), or the Validate step's own three-line tag translation.
    const allowed = new Set([
      resolveOutput,
      'VERSION="$PACKAGE_VERSION"',
      'VERSION="${{ github.ref_name }}"',
      'VERSION="${VERSION#v}"',
    ])
    expect(versionAssignments.filter((line) => !allowed.has(line))).toEqual([])
    // Most of them resolve from metadata; exactly one reads the ref (see next assertion).
    expect(versionAssignments.filter((line) => line === resolveOutput).length).toBeGreaterThan(2)
    // Exactly one VERSION assignment may read the ref, and it must be the Validate step's
    // tag translation -- every later step takes the resolved output instead.
    expect(versionAssignments.filter((line) => line.includes('github.ref_name'))).toEqual([
      'VERSION="${{ github.ref_name }}"',
    ])
  })

  it.skipIf(!hasBash())(
    'derives the dry-run version from package.json and keeps the tag check for a tag',
    () => {
      const script = validateScript(buildJob())

      // A tag push renders '' for the input (the `inputs` context is empty) and must
      // still resolve to the tag's own version.
      const tag = runValidate(script, { dryRun: '', refName: `v${packageVersion}` })
      expect(tag.status, tag.stderr).toBe(0)
      expect(tag.version).toBe(packageVersion)

      // A dry run carries no tag, so it must fall back to the package version.
      const dryRun = runValidate(script, { dryRun: 'true', refName: 'main' })
      expect(dryRun.status, dryRun.stderr).toBe(0)
      expect(dryRun.version).toBe(packageVersion)

      // A tag that disagrees with the package metadata must still fail the release, on a
      // push and on an unchecked dispatch -- both are real releases. 'false' is what
      // GitHub renders for an unchecked boolean input, so it must not take the dry-run
      // branch; if it did, the tag check would be skipped and publish would still run.
      for (const dryRunText of ['', 'false']) {
        const mismatched = runValidate(script, { dryRun: dryRunText, refName: 'v0.0.1' })
        expect(mismatched.status, `dry_run='${dryRunText}'`).not.toBe(0)
        expect(mismatched.stderr).toContain('does not match package metadata')
      }
    }
  )
})
