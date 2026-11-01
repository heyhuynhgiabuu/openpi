import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const ciWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

describe('durable runtime e2e gate', () => {
  it('runs the shell-turn spec automatically instead of only by manual dispatch', () => {
    // Phase 8 item 8: a regression in the durable runtime used to pass every check,
    // because the specs only ran through `e2e.yml`'s manual dispatch and skipped without
    // the flag. This pins the automatic gate.
    expect(ciWorkflow).toContain('npx playwright test tests/e2e/durableGate.spec.ts')
    expect(ciWorkflow).toContain("OPENPI_E2E_DURABLE: '1'")
    // It rides the Linux build leg, which is the only place the app is built and where
    // xvfb is available; an unconditional step would fail on the other legs.
    const step = ciWorkflow.slice(ciWorkflow.indexOf('name: Durable runtime e2e'))
    const body = step.slice(0, step.indexOf('- name: Upload Playwright traces'))
    expect(body).toContain("if: matrix.os == 'ubuntu-latest'")
    expect(body).toContain('xvfb-run')
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
