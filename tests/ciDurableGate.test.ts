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
    const runBody = body.slice(body.indexOf('run: |'))
    // The reporter is required, not cosmetic: the assertion script reads its output, and a run
    // without it would fail the step for the wrong reason.
    expect(runBody).toContain('--reporter=json')
    // _OUTPUT_FILE, not _OUTPUT_NAME: Playwright resolves FILE before DIR before NAME, so the
    // name form loses to an _OUTPUT_DIR that a later edit could add to this step's `env:`.
    expect(runBody).toContain('PLAYWRIGHT_JSON_OUTPUT_FILE=durable-gate.json')
    expect(runBody).not.toContain('PLAYWRIGHT_JSON_OUTPUT_DIR')
    // The report is removed first: without this, a report left in the workspace by an earlier run
    // satisfies the assertion even when this run's spec returned early.
    //
    // The WHOLE command list is pinned below, not just the first and last entries. Anything in
    // between could otherwise overwrite the report after Playwright wrote it -- `cp forged.json
    // durable-gate.json` right before the assertion passed a first-and-last check.
    expect(runBody).toContain('tests/e2e/durableGate.spec.ts')
    // The assertion must be the last thing the step does. If Playwright's exit code were allowed
    // to be the verdict, a suite that skips itself would pass.
    // Slice to the end of the `run:` scalar, which stops where the next `env:` key begins.
    const runScalar = runBody.slice(runBody.indexOf('|') + 1, runBody.indexOf('env:'))
    const commands = runScalar
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    expect(commands).toEqual([
      'rm -f durable-gate.json',
      'PLAYWRIGHT_JSON_OUTPUT_FILE=durable-gate.json \\',
      'xvfb-run --auto-servernum npx playwright test \\',
      'tests/e2e/durableGate.spec.ts --reporter=json',
      'node scripts/assertGateRan.mjs durable-gate.json',
    ])
    // The step's OTHER keys are pinned too, not just its `run:` lines. `env:` is the way a
    // command can be made to do nothing without touching the pinned lines: adding
    // `NODE_OPTIONS: --import=data:text/javascript,process.exit(0)` made the step exit 0 with
    // Playwright and the assertion never running, and no test noticed. `shell:` can do the same
    // by prefixing the script with `true`.
    expect(gateStep()).not.toMatch(/^\s*(NODE_OPTIONS|BASH_ENV|PLAYWRIGHT_JSON_OUTPUT_DIR)\s*:/m)
    expect(gateStep()).not.toMatch(/^\s*shell\s*:/m)
    expect(gateStep()).toContain("ELECTRON_DISABLE_SANDBOX: '1'")
    expect(gateStep()).toContain("OPENPI_E2E_DURABLE: '1'")
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
    // The step's guard compares against 'ubuntu-latest', so that exact label has to stay in
    // the matrix. Renaming it (pinning the runner, as windows-2022 already is) would skip
    // the gate silently while every check stayed green.
    const osLine = buildJob.split('\n').find((line) => line.trim().startsWith('os: ['))
    expect(osLine).toBeDefined()
    expect(osLine?.split(',').map((entry) => entry.trim())).toContain('ubuntu-latest')
    // No job-level `if:` either: `if: github.event_name == 'push'` on this job would skip
    // the gate on every PR while the check stayed green.
    const jobLevelConditions = buildJob.split('\n').filter((line) => /^    if:/.test(line))
    expect(jobLevelConditions).toEqual([])
    // `--pass-with-no-tests` would let a deleted or renamed spec exit 0.
    expect(body).not.toContain('--pass-with-no-tests')
  })

  it('would notice if the spec started skipping itself', () => {
    // The whole gate disappears silently if the spec's own guard is renamed or a skip is
    // added: Playwright reports "1 skipped" and exits 0, and ci.yml is untouched. Pin the
    // guard, and pin that the spec still names the file CI invokes.
    // Pin the WHOLE skip call, not a substring of its condition: appending `|| true` to
    // the condition keeps `toContain` happy while turning the gate into a permanent skip.
    expect(spec).toContain(
      [
        '  test.skip(',
        "    process.env.OPENPI_E2E_DURABLE !== '1',",
        "    'manual run: set OPENPI_E2E_DURABLE=1 (this drives a real renderer session)'",
        '  )',
      ].join('\n')
    )
    // `test.fixme` and `describe.skip` retire the gate just as `test.skip` does; count all
    // of them, and require that the live (non-skipped) test case still exists.
    const retirePatterns = spec.match(/test\.(skip|fixme)\(|describe\.skip\(/g) ?? []
    expect(retirePatterns).toHaveLength(1)
    expect(spec).toContain("test('drives a shell turn through the renderer on the durable runtime'")
  })

  /** Escape a literal for use inside `new RegExp`. */
  function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  it('requires the spec to record that its body reached the end', () => {
    // Counters cannot catch an early return: measured with Playwright, a body that returns right
    // after the skip call still reports expected:1, skipped:0 and "passed". The witness annotation
    // is the only signal a report-reading script can require, so it is pinned on both sides.
    expect(spec).toContain("const GATE_WITNESS_TYPE = 'gate-body-completed'")
    expect(spec).toContain("const GATE_WITNESS = 'durable-shell-turn'")
    const push =
      'test.info().annotations.push({ type: GATE_WITNESS_TYPE, description: GATE_WITNESS })'
    // Exactly once. `toContain` alone let a second copy sit anywhere, so a body could push the
    // witness and then return -- the report carries the annotation and every check stays green.
    expect(spec.split(push)).toHaveLength(2)
    // And nothing else in the spec may touch annotations at all. Pinning the one exact line still
    // let `const info = test.info(); info.annotations.push(...)` retire the gate: a review ran
    // exactly that with the pinned line left in place, and every check stayed green. Counting the
    // ACCESSOR rather than one spelling closes the rewrite; banning the declarative form closes
    // `test('x', { annotation: [...] }, ...)`, and banning the hooks closes an annotation written
    // for a body that returned early.
    expect(spec.match(/annotations/g) ?? []).toHaveLength(1)
    for (const banned of ['annotation:', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
      expect(spec).not.toContain(banned)
    }
    // And last, immediately before the test's OWN cleanup `finally`, because "the body reached
    // its end" is only true of the final statement.
    //
    // Matching `push } finally {` alone was not enough: a review wrapped the single push in
    // `const recordWitness = () => { try { <push> } finally {} }`, called it right after
    // test.skip, then returned. `annotations` still appeared exactly once, the regex still
    // matched, and the gate ran in 313 ms with Electron never launching. Requiring the cleanup
    // lines this file actually has, after the push, leaves nowhere else the pattern can match.
    expect(spec).toMatch(
      new RegExp(`${escapeRegExp(push)}\\s*\\}\\s*finally\\s*{\\s*await app\\?\\.close\\(\\)`)
    )
    // Exactly one finally in the whole file, so "the finally after the push" is unambiguous.
    expect(spec.match(/\}\s*finally\s*\{/g) ?? []).toHaveLength(1)
    const runner = readFileSync(resolve(root, 'scripts/assertGateRan.mjs'), 'utf8')
    expect(runner).toContain("const WITNESS_TYPE = 'gate-body-completed'")
    expect(runner).toContain("const WITNESS = 'durable-shell-turn'")
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
    //
    // Reads the joined command list: slicing to the end of the `run:` LINE only ever saw the
    // literal `run: |` block header, so this assertion could not fail. It can again.
    const commands = gateStep()
      .split('\n')
      .map((line) => line.trim())
      .join(' ')
    const invocations = commands.match(/playwright test[^&|;]*/g) ?? []
    expect(invocations.length).toBeGreaterThan(0)
    for (const invocation of invocations) {
      expect(invocation).toContain('tests/e2e/durableGate.spec.ts')
    }
  })
})
