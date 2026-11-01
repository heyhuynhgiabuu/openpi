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

/**
 * Find the witness annotation in the report, whichever nesting Playwright used.
 * @param {unknown} node
 * @returns {boolean}
 */
function hasWitness(node) {
  if (typeof node !== 'object' || node === null) return false
  const record = /** @type {Record<string, unknown>} */ (node)
  const annotations = record.annotations
  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      if (typeof annotation !== 'object' || annotation === null) continue
      const entry = /** @type {Record<string, unknown>} */ (annotation)
      if (entry.type === WITNESS_TYPE && entry.description === WITNESS) return true
    }
  }
  const results = record.results
  if (Array.isArray(results) && results.some(hasWitness)) return true
  const suites = record.suites
  if (Array.isArray(suites) && suites.some(hasWitness)) return true
  const specs = record.specs
  if (Array.isArray(specs) && specs.some(hasWitness)) return true
  const tests = record.tests
  if (Array.isArray(tests) && tests.some(hasWitness)) return true
  return false
}

const path = process.argv[2]
if (!path) fail('no report path given')

const stats = readStats(path)
const parsed = JSON.parse(readFileSync(path, 'utf8'))
// Most specific cause first: a skip is a different failure from a run that never happened, and
// saying "skipped" is what points at the guard rather than at the config.
if (stats.skipped !== 0) fail(`${stats.skipped} test(s) skipped, so the gate retired itself`)
if (stats.expected !== 1)
  fail(`expected exactly 1 test to pass, got ${stats.expected} (the spec did not run)`)
if (stats.unexpected !== 0) fail(`${stats.unexpected} test(s) failed unexpectedly`)
if (stats.flaky !== 0) fail(`${stats.flaky} test(s) were flaky, so the run is not trustworthy`)

// The counters can be satisfied by a body that returned immediately. The witness cannot.
if (!hasWitness(parsed)) fail('the test body did not reach its end (no completion witness)')

process.stdout.write('durable gate: exactly one test ran, none skipped\n')
