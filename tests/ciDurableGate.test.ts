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
    expect(body).toContain(
      'run: xvfb-run --auto-servernum npx playwright test tests/e2e/durableGate.spec.ts'
    )
    // The flag has to be on this step: moved elsewhere, the spec skips and the run is
    // green for the wrong reason.
    expect(body).toContain("OPENPI_E2E_DURABLE: '1'")
    // It rides the Linux build leg: xvfb is Linux-only, and an unguarded step would fail
    // on the macOS and Windows legs. Every leg builds the app, so this is not the only
    // place a build exists -- it is the only place with a display.
    expect(body).toContain("if: matrix.os == 'ubuntu-latest'")
    // A gate that may fail without failing the job is not a gate.
    expect(body).not.toContain('continue-on-error')
    // `--pass-with-no-tests` would let a deleted or renamed spec exit 0.
    expect(body).not.toContain('--pass-with-no-tests')
  })

  it('would notice if the spec started skipping itself', () => {
    // The whole gate disappears silently if the spec's own guard is renamed or a skip is
    // added: Playwright reports "1 skipped" and exits 0, and ci.yml is untouched. Pin the
    // guard, and pin that the spec still names the file CI invokes.
    expect(spec).toContain("process.env.OPENPI_E2E_DURABLE !== '1'")
    expect(spec).toContain('test.skip(')
    expect(spec.match(/test\.skip\(/g)).toHaveLength(1)
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
