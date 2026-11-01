import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The durable e2e gate has to prove it RAN, not that its source looks right.
 *
 * `ciDurableGate.test.ts` pins the spec's text, which cannot catch a spec that retires itself
 * without saying so: an early `return`, an env overwrite before the guard, or `test['skip']`.
 * Playwright exits 0 when everything skips, so the step's exit code proves nothing. This pins the
 * reporter check that reads the run's own facts instead — and in particular that it fails when the
 * report is missing, malformed, or empty, because a check that passes on no input is worse than
 * none.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'assertGateRan.mjs')
const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * Write a report with the given stats and run the assertion; return its exit code and output.
 *
 * `file` exists so a case can use the exact argument CI passes (`durable-gate.json`) rather than
 * an absolute temp path: a script edited to exit 0 on that one name would otherwise never be
 * exercised by this rehearsal.
 */
function run(
  report: unknown,
  write = true,
  file = 'report.json'
): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpi-gate-'))
  dirs.push(dir)
  const path = join(dir, file)
  if (write) writeFileSync(path, typeof report === 'string' ? report : JSON.stringify(report))
  try {
    // The argument is the *relative* name, matching the workflow line verbatim. Passing an
    // absolute path instead would leave a `if (path === 'durable-gate.json') exit(0)` branch
    // unexercised -- measured: that mutant survived every case until this was relative.
    const output = execFileSync(process.execPath, [script, file], {
      encoding: 'utf8',
      cwd: dir,
    })
    return { code: 0, output }
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failed.status ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

/**
 * A report shaped like a real run: one passing test in the gate's own file, carrying the witness.
 *
 * The file and title are load-bearing, not decoration. The script matches them so a decoy spec
 * selected by the CLI filter, or a witness recorded somewhere else in the tree, cannot stand in
 * for the gate test.
 */
const GATE_FILE = 'durableGate.spec.ts'
const GATE_TITLE = 'drives a shell turn through the renderer on the durable runtime'

const witnessed = () => ({
  // Real-report fields, so an edit to the script keyed on them is visible here. Without these, a
  // check like `if (!parsed.config && !holdsWitness(...))` -- accept anything that looks like a
  // real report -- passed the whole rehearsal and let an early return through.
  config: { rootDir: '/repo/tests/e2e', projects: [{ name: 'chromium' }] },
  stats: { startTime: '2026-11-01T00:00:00.000Z', duration: 4308 },
  suites: [
    {
      file: GATE_FILE,
      specs: [
        {
          title: GATE_TITLE,
          file: GATE_FILE,
          tests: [
            {
              title: GATE_TITLE,
              status: 'expected',
              results: [
                {
                  status: 'passed',
                  annotations: [{ type: 'gate-body-completed', description: 'durable-shell-turn' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
})

// Merge the counters INTO the realistic stats block rather than replacing it: replacing dropped
// `startTime`/`duration`, which is how an edit keyed on those fields stayed invisible to this file.
/**
 * Replace only the counters, keeping the realistic report fields a real run writes.
 *
 * Generic so the caller keeps its concrete type: a plain `Record<string, unknown>` spread erased
 * `suites`, and the cases that mutate `suites[0]` then failed typecheck while the tests passed.
 */
function counted<T extends object>(report: T, stats: Record<string, number>): T {
  const previous = 'stats' in report ? report.stats : undefined
  const merged = { ...(previous as Record<string, unknown> | undefined), ...stats }
  return { ...report, stats: merged }
}

const passing = (stats: Record<string, number>) => {
  const base = witnessed()
  return { ...base, stats: { ...base.stats, ...stats } }
}

describe('the durable gate asserts it ran', () => {
  it('passes on a healthy run of exactly one test', () => {
    const result = run(passing({ expected: 1, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(0)
    expect(result.output).toContain('exactly one test ran')
  })

  it('fails when the body returned early, even though Playwright reports one passing test', () => {
    // The dangerous retirement, measured: an early `return` gives exactly these counters and a
    // "passed" result. Only the missing witness distinguishes it from a real run.
    const result = run({
      suites: [{ specs: [{ tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }],
      stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('completion witness')
  })

  it('fails when the witness names a different test, so a copy-paste cannot stand in', () => {
    const report = witnessed()
    report.suites[0].specs[0].tests[0].results[0].annotations = [
      { type: 'gate-body-completed', description: 'some-other-spec' },
    ]
    const result = run(counted(report, { expected: 1, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
  })

  it('fails when the spec retired itself by skipping', () => {
    // What a `test.skip`, a `test.fixme` or an env overwrite reports -- and Playwright exits 0.
    const result = run(passing({ expected: 0, skipped: 1, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('skipped')
  })

  it('fails when the early-return form leaves nothing to report as passed', () => {
    // An early `return` inside the test body reports a pass, so the count is what catches a suite
    // that ran the wrong test, and `expected !== 1` is the guard for "no test at all".
    const result = run(passing({ expected: 0, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('did not run')
  })

  it('fails when a second test appeared, so the gate is no longer the thing being checked', () => {
    const result = run(passing({ expected: 2, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
  })

  it('fails when the witness comes from a different file, even with every counter right', () => {
    // The CLI filter is a substring match, so `durableGate.spec.tsx` is selected by
    // `playwright test tests/e2e/durableGate.spec.ts`. With `testIgnore` in the config pointing
    // away from the real spec, a decoy carrying the witness made every check green while Electron
    // never launched. The file has to match, not just the annotation.
    const decoy = witnessed()
    decoy.suites[0].file = 'durableGate.spec.tsx'
    decoy.suites[0].specs[0].file = 'durableGate.spec.tsx'
    const result = run(counted(decoy, { expected: 1, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('completion witness')
  })

  it('fails when the witness sits on an earlier result than the one that decided the run', () => {
    // A retried run's first attempt can carry an annotation the final one does not. Only the last
    // result speaks for the outcome.
    const retried = witnessed()
    const test = retried.suites[0].specs[0].tests[0]
    test.results = [test.results[0], { status: 'passed', annotations: [] }]
    const result = run(counted(retried, { expected: 1, skipped: 0, unexpected: 0, flaky: 0 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('completion witness')
  })

  it('fails when the annotation has the right description but the wrong type', () => {
    // Both halves of the witness are load-bearing. Matching only the description would let any
    // annotation that happens to carry the string stand in for the gate's own marker.
    const wrongType = counted(witnessed(), {
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    })
    const annotation = { type: 'something-else', description: 'durable-shell-turn' }
    wrongType.suites[0].specs[0].tests[0].results[0].annotations = [annotation]
    const result = run(wrongType)
    expect(result.code).toBe(1)
    expect(result.output).toContain('completion witness')
  })

  it('reports a failed test as a failure, not as a run that never happened', () => {
    // `unexpected` had no case, so deleting the check that reads it kept the rehearsal green.
    // A failure is also a more specific cause than the count, so it is reported first.
    const result = run(passing({ expected: 0, skipped: 0, unexpected: 1, flaky: 0 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('failed unexpectedly')
    expect(result.output).not.toContain('expected exactly 1')
  })

  it('reports a flaky run as flaky, not as a run that never happened', () => {
    // `expected: 0, flaky: 1` is what a retried pass looks like, and it used to be reported as
    // "the spec did not run" -- a message that sends the reader to the wrong place.
    const result = run(passing({ expected: 0, skipped: 0, unexpected: 0, flaky: 1 }))
    expect(result.code).toBe(1)
    expect(result.output).toContain('flaky')
    expect(result.output).not.toContain('did not run (the spec did not run)')
    expect(result.output).not.toContain('expected exactly 1')
  })

  it('fails rather than passing when there is no report at all', () => {
    const result = run(null, false)
    expect(result.code).toBe(1)
    expect(result.output).toContain('no report')
  })

  it('fails on a report with no stats block, instead of reading absence as success', () => {
    const result = run({ suites: [] })
    expect(result.code).toBe(1)
    expect(result.output).toContain('no stats block')
  })

  it('fails when a count is missing, instead of treating it as zero', () => {
    const result = run({ stats: { expected: 1, skipped: 0, unexpected: 0 } })
    expect(result.code).toBe(1)
    expect(result.output).toContain('flaky')
  })

  it('holds to the same verdict with the literal argument CI passes', () => {
    // Same two verdicts, but through `durable-gate.json` exactly as `.github/workflows/ci.yml`
    // invokes the script. A branch keyed on that filename -- `if (path === 'durable-gate.json')
    // process.exit(0)` -- would pass every other case here and retire the gate, so the failing
    // verdict has to be exercised on this path too. A stale report is the case that reaches it:
    // Playwright never writes a fresh report, `rm -f` in the step is what prevents this, and no
    // check inside the script can tell an old report from a new one.
    const unwitnessed = counted(witnessed(), {
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    })
    unwitnessed.suites[0].specs[0].tests[0].results[0].annotations = []
    const failed = run(unwitnessed, true, 'durable-gate.json')
    expect(failed.code).toBe(1)
    expect(failed.output).toContain('completion witness')

    const healthy = run(
      passing({ expected: 1, skipped: 0, unexpected: 0, flaky: 0 }),
      true,
      'durable-gate.json'
    )
    expect(healthy.code).toBe(0)
  })

  it('fails on malformed JSON', () => {
    const result = run('{"stats": ')
    expect(result.code).toBe(1)
    expect(result.output).toContain('not valid JSON')
  })
})
