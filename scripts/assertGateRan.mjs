#!/usr/bin/env node
/**
 * Fail unless the durable e2e gate actually ran one test and skipped none.
 *
 * `tests/ciDurableGate.test.ts` pins the *source* of the spec and the workflow. That catches
 * accidental edits, but the spec is a program: an early `return`, an env overwrite before the
 * guard, or the bracket form `test['skip']` all retire the gate while the pin, typecheck, lint and
 * the whole unit suite stay green. The dangerous one reports **1 passed** in the log, so a human
 * skimming it sees nothing wrong.
 *
 * Playwright's exit code cannot tell "ran" from "did nothing", because a suite where everything
 * skips still exits 0. So this reads the JSON report the step just wrote and requires the facts a
 * running gate produces: one expected test, nothing skipped, nothing flaky, nothing failed.
 *
 * Counters alone are not enough. An early `return` inside the test body reports a normal pass --
 * measured, not assumed: `expected: 1, skipped: 0` with the body never executing. The spec
 * therefore records a witness annotation as its last statement, and this requires that witness.
 * Without it the check would be satisfied by exactly the retirement it exists to catch.
 *
 * Deliberately strict about shape: a missing or malformed report is a failure, never a pass. That
 * is the difference between a check and the appearance of one.
 *
 * WHAT THIS DOES NOT PROVE. A person can still retire this gate, and every automated check can stay
 * green. This list is what is KNOWN to survive today, not a proof that it is complete:
 *   1. A spec that records the witness but asserts nothing about the app. Nothing in the report
 *      distinguishes "the marker was verified" from "the marker was never looked for".
 *   2. A spec that writes the witness before doing the work and returns afterwards. The pins in
 *      `ciDurableGate.test.ts` require it exactly once, as the last statement before the cleanup
 *      `finally`, with no lifecycle hooks -- which closes every rewrite found so far, not the next.
 *   3. An edit to THIS file. The rehearsal runs fixtures in a temp directory, so anything keyed on
 *      the environment, the working directory, or a report field a fixture does not carry can add
 *      a bypass unexercised. Fixtures now carry `config`/`startTime`/`duration` for that reason.
 *   4. Skipping the leg entirely: `matrix.exclude` dropping ubuntu, or the step's own `env:` /
 *      `shell:` being changed. Nothing here reads the matrix, and the repository has no branch
 *      protection, so even a red gate would not block a merge.
 *   5. Anything that changes `playwright.config.ts` together with the spec, or emits the witness
 *      from a worker that did no work.
 * This is a guard against ACCIDENT, and against a model confidently "fixing" the gate by moving
 * the witness up. Treat changes to this file, the spec, the config and the workflow as needing a
 * human, because nothing enforces that they get one.
 */
import { readFileSync } from 'node:fs'

/** @param {string} reason */
function fail(reason) {
  process.stderr.write(`::error::durable gate did not run: ${reason}\n`)
  process.exit(1)
}

/**
 * Read `stats` out of a Playwright JSON report, or explain why it cannot be read.
 * @param {string} path
 */
function readStats(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    fail(`no report at ${path} (did Playwright run?)`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(`${path} is not valid JSON`)
  }

  if (typeof parsed !== 'object' || parsed === null) fail(`${path} has no report object`)
  const stats = parsed.stats
  if (typeof stats !== 'object' || stats === null) fail(`${path} has no stats block`)

  /** @param {string} key */
  const pick = (key) => {
    const value = stats[key]
    // A missing count is not zero: an empty report must not satisfy the gate by omission.
    if (typeof value !== 'number' || !Number.isFinite(value))
      fail(`stats.${key} is missing or not a number`)
    return value
  }
  return {
    expected: pick('expected'),
    skipped: pick('skipped'),
    unexpected: pick('unexpected'),
    flaky: pick('flaky'),
  }
}

/** The annotation the spec writes as its final act; keep in step with the spec's constants. */
const WITNESS_TYPE = 'gate-body-completed'
const WITNESS = 'durable-shell-turn'

/** The gate test's file and title, matched against the report's own structure. */
const GATE_FILE = 'durableGate.spec.ts'
const GATE_TITLE = 'drives a shell turn through the renderer on the durable runtime'

/**
 * Find the ONE test the gate is about, and require ITS result to carry the witness.
 *
 * Searching the whole tree for an annotation was not enough. A report also describes WHICH file
 * and which test produced it, and ignoring that let two edits through with every check green:
 * `testIgnore` in `playwright.config.ts` plus a decoy `durableGate.spec.tsx` (the CLI filter is a
 * substring match, so it still selected the decoy), and moving the single witness push into a
 * helper called before an early `return`. Binding to the file and title closes the decoy; requiring
 * the witness on that test's own last result closes the "somewhere in the tree" reading.
 *
 * @param {unknown} node
 * @param {string[]} files
 * @returns {boolean}
 */
function holdsWitness(node, files) {
  if (typeof node !== 'object' || node === null) return false
  const record = /** @type {Record<string, unknown>} */ (node)
  const ownFile = typeof record.file === 'string' ? record.file : undefined
  const nextFiles = ownFile ? [...files, ownFile] : files
  const inGateFile = nextFiles.some((file) => file.endsWith(GATE_FILE))

  if (inGateFile && Array.isArray(record.tests)) {
    for (const candidate of record.tests) {
      if (typeof candidate !== 'object' || candidate === null) continue
      const test = /** @type {Record<string, unknown>} */ (candidate)
      if (test.title !== GATE_TITLE) continue
      if (!Array.isArray(test.results) || test.results.length === 0) continue
      // The LAST result is the one that decided the outcome; an earlier retry's annotation is
      // not evidence that this run reached the end.
      const last = test.results[test.results.length - 1]
      if (hasAnnotation(last) || hasAnnotation(test)) return true
      return false
    }
  }
  for (const key of ['suites', 'specs']) {
    const children = record[key]
    if (Array.isArray(children) && children.some((child) => holdsWitness(child, nextFiles))) {
      return true
    }
  }
  return false
}

/** @param {unknown} node */
function hasAnnotation(node) {
  if (typeof node !== 'object' || node === null) return false
  const annotations = /** @type {Record<string, unknown>} */ (node).annotations
  if (!Array.isArray(annotations)) return false
  return annotations.some((annotation) => {
    if (typeof annotation !== 'object' || annotation === null) return false
    const entry = /** @type {Record<string, unknown>} */ (annotation)
    return entry.type === WITNESS_TYPE && entry.description === WITNESS
  })
}

const path = process.argv[2]
if (!path) fail('no report path given')

const stats = readStats(path)
const parsed = JSON.parse(readFileSync(path, 'utf8'))
// Most specific cause first: a skip is a different failure from a run that never happened, and
// saying "skipped" is what points at the guard rather than at the config.
if (stats.skipped !== 0) fail(`${stats.skipped} test(s) skipped, so the gate retired itself`)
// A failure or a flaky retry is a more specific cause than the count being off, and both make the
// count off. Reported in this order so the message names what actually happened: a flaky run
// reports `expected: 0, flaky: 1`, which used to be described as "the spec did not run".
if (stats.unexpected !== 0) fail(`${stats.unexpected} test(s) failed unexpectedly`)
if (stats.flaky !== 0) fail(`${stats.flaky} test(s) were flaky, so the run is not trustworthy`)
if (stats.expected !== 1)
  fail(
    `expected exactly 1 test to pass, got ${stats.expected}. If you added a test, it needs its ` +
      'own witness and an updated scripts/assertGateRan.mjs; if you did not, the gate did not run.'
  )

// The counters can be satisfied by a body that returned immediately. The witness cannot.
if (!holdsWitness(parsed, [])) {
  fail(`the gate test (${GATE_FILE} > ${GATE_TITLE}) did not record a completion witness`)
}

process.stdout.write('durable gate: exactly one test ran, none skipped\n')
