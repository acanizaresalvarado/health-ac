import { spawn } from 'node:child_process'

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const processes = [
  { name: 'api', args: ['run', 'dev:api'] },
  { name: 'web', args: ['run', 'dev:web'] }
]

const children = []
let shuttingDown = false

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    try {
      child.kill('SIGTERM')
    } catch {
      // Ignore process kill errors.
    }
  }

  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore process kill errors.
      }
    }
    process.exit(exitCode)
  }, 1200)
}

for (const processDef of processes) {
  const child = spawn(npmCmd, processDef.args, {
    stdio: 'inherit',
    env: process.env
  })
  children.push(child)

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.error(`[dev-runner] ${processDef.name} exited with code ${code ?? 0}`)
    shutdown(code ?? 1)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
