import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const ciWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const spec = readFileSync(resolve(root, 'tests/e2e/durableGate.spec.ts'), 'utf8')

/** The gate step's own text up to the next step, so a check cannot pass on another step's line. */
function gateStep(): string {
  const start = ciWorkflow.indexOf('- name: Durable runtime e2e')
  if (start < 0) throw new Error('The durable e2e gate step is missing from ci.yml')
  const next = ciWorkflow.indexOf('\n      - ', start)
  return ciWorkflow.slice(start, next < 0 ? undefined : next)
}

describe('durable runtime e2e gate', () => {
  it('runs the shell-turn spec automatically instead of only by manual dispatch', () => {
    // Phase 8 item 8: a regression in the durable runtime used to pass every check,
    // because the specs only ran through `e2e.yml`'s manual dispatch and skipped without
    // the flag. This pins the automatic gate.
    const body = gateStep()
    const lines = body.split('\n').map((line) => line.trim())
    // Exact lines, not `toContain`: a `|| true` suffix would make the step exit 0 even when
    // the spec fails, and a commented-out env line would still contain the flag text.
    expect(lines).toContain(
      'run: xvfb-run --auto-servernum npx playwright test tests/e2e/durableGate.spec.ts'
    )
    // The flag has to be on this step, as its own line: moved elsewhere the spec skips and
    // the run is green for the wrong reason.
    expect(lines.filter((line) => line.startsWith('OPENPI_E2E_DURABLE'))).toEqual([
      "OPENPI_E2E_DURABLE: '1'",
    ])
    // It rides the Linux build leg: xvfb is Linux-only, and an unguarded step would fail
    // on the macOS and Windows legs. Every leg builds the app, so this is not the only
    // place a build exists -- it is the only place with a display.
    expect(lines).toContain("if: matrix.os == 'ubuntu-latest'")
    // No extra conjunct: `&& false` would keep the substring while never running the step.
    expect(lines.filter((line) => line.startsWith('if: matrix.os'))).toEqual([
      "if: matrix.os == 'ubuntu-latest'",
    ])
    // A gate that may fail without failing the job is not a gate -- at step level or at
    // job level, so check the whole build job rather than only this step.
    // `build` is the last job in the file, so the slice runs to the end -- and the
    // non-empty guard matters, because an empty slice would pass this vacuously.
    const buildStart = ciWorkflow.indexOf('\n  build:\n')
    expect(buildStart).toBeGreaterThan(-1)
    const buildJob = ciWorkflow.slice(buildStart)
    expect(buildJob).toContain('matrix:')
    expect(buildJob).not.toContain('continue-on-error')
    // `--pass-with-no-tests` would let a deleted or renamed spec exit 0.
    expect(body).not.toContain('--pass-with-no-tests')
  })

  it('would notice if the spec started skipping itself', () => {
    // The whole gate disappears silently if the spec's own guard is renamed or a skip is
    // added: Playwright reports "1 skipped" and exits 0, and ci.yml is untouched. Pin the
    // guard, and pin that the spec still names the file CI invokes.
    expect(spec).toContain("process.env.OPENPI_E2E_DURABLE !== '1'")
    // `test.fixme` and `describe.skip` retire the gate just as `test.skip` does; count all
    // of them, and require that the live (non-skipped) test case still exists.
    const retirePatterns = spec.match(/test\.(skip|fixme)\(|describe\.skip\(/g) ?? []
    expect(retirePatterns).toHaveLength(1)
    expect(spec).toContain("test('drives a shell turn through the renderer on the durable runtime'")
  })

  it('leaves the prompt-turn spec manual, because it needs a model key and the local models.json', () => {
    // Automating it would put HIVE_API_KEY in CI and read the developer's own
    // ~/.pi/agent/models.json, so the gate would be both secret-bearing and machine-
    // dependent. Pinned so it cannot be wired in without deleting this assertion.
    expect(ciWorkflow).not.toContain('durablePrompt.spec.ts')
    expect(ciWorkflow).not.toContain('HIVE_API_KEY')
  })

  it('does not run the other e2e specs with this step', () => {
    // A bare `npx playwright test` would also run smoke.spec.ts, which has no env guard.
    // Naming the spec file keeps the automated gate limited to the durable witness.
    const step = ciWorkflow.slice(ciWorkflow.indexOf('name: Durable runtime e2e'))
    const runLine = step.slice(step.indexOf('run:'), step.indexOf('\n', step.indexOf('run:')))
    expect(runLine).not.toMatch(/playwright test\s*$/)
  })
})
