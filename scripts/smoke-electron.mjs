#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const timeoutMs = Number.parseInt(process.env.OPENPI_SMOKE_TIMEOUT_MS ?? '8000', 10)

const child = spawn(electronPath, ['.'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    OPENPI_SMOKE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

let settled = false

function finish(code, message) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  if (message) console.log(message)
  if (output.trim()) console.log(output.trim())
  process.exit(code)
}

child.on('error', (error) => {
  finish(1, `[smoke] failed to launch Electron: ${error.message}`)
})

child.on('exit', (code, signal) => {
  if (settled) return
  if (code === 0 || signal === 'SIGTERM') {
    finish(0, '[smoke] Electron exited cleanly')
    return
  }
  finish(
    1,
    `[smoke] Electron exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`
  )
})

const timer = setTimeout(() => {
  if (settled) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!settled) child.kill('SIGKILL')
  }, 1000).unref()
  finish(0, `[smoke] Electron stayed alive for ${timeoutMs}ms`)
}, timeoutMs)
