// Nuxt는 .env만 읽는다. 이미 있는 환경 변수는 유지하고 .env.local을 이어서 넣는다.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const originalKeys = new Set(Object.keys(process.env))

for (const file of ['.env', '.env.local']) {
  loadEnvFile(join(root, file))
}

const nuxtBin = join(root, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
const child = spawn(process.execPath, [nuxtBin, ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

function loadEnvFile(file) {
  if (!existsSync(file)) {
    return
  }
  for (const line of readFileSync(file, 'utf8').split(/\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator < 1) {
      continue
    }
    const key = trimmed.slice(0, separator).trim()
    const value = unquote(trimmed.slice(separator + 1).trim())
    if (!key || originalKeys.has(key) || !value) {
      continue
    }
    process.env[key] = value
  }
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}
