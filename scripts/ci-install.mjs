#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'

function install() {
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm ci'], {
      stdio: 'inherit',
    })
  }
  return spawnSync('npm', ['ci'], { stdio: 'inherit' })
}

let result = install()
if (result.status !== 0) {
  console.warn('[ci-install] npm ci failed; cleaning node_modules and retrying once')
  fs.rmSync('node_modules', { recursive: true, force: true, maxRetries: 3, retryDelay: 1_000 })
  result = install()
}

if (result.error) throw result.error
process.exit(result.status ?? 1)
