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

/** Write a report with the given stats and run the assertion; return its exit code and output. */
function run(report: unknown, write = true): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openpi-gate-'))
  dirs.push(dir)
  const path = join(dir, 'report.json')
  if (write) writeFileSync(path, typeof report === 'string' ? report : JSON.stringify(report))
  try {
    const output = execFileSync(process.execPath, [script, path], { encoding: 'utf8' })
    return { code: 0, output }
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failed.status ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

/** A report shaped like a real run: one passing test carrying the spec's completion witness. */
const witnessed = () => ({
  suites: [
    {
      specs: [
        {
          tests: [
            {
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

const passing = (stats: Record<string, number>) => ({ ...witnessed(), stats })

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
    expect(result.output).toContain('did not reach its end')
  })

  it('fails when the witness names a different test, so a copy-paste cannot stand in', () => {
    const report = witnessed()
    report.suites[0].specs[0].tests[0].results[0].annotations = [
      { type: 'gate-body-completed', description: 'some-other-spec' },
    ]
    const result = run({ ...report, stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 } })
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

  it('fails on malformed JSON', () => {
    const result = run('{"stats": ')
    expect(result.code).toBe(1)
    expect(result.output).toContain('not valid JSON')
  })
})
