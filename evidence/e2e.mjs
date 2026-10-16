/**
 * End-to-end acceptance suite for @yokira404/dsh-git-guard.
 *
 * This is the second half of the verification the plugin ships with. `selftest.mjs`
 * proves the *rules*; this proves the *installation* — that a real DSH Host boots
 * with the plugin as a profile bundle, that the row activates with its services
 * resolved, that the built Client half is composed and served, and that a real
 * `bash` tool call is blocked or allowed through the live `tools/pre-execute`
 * pipeline according to the two switches.
 *
 * It touches nothing outside its own scratch directory and one disposable profile:
 *
 *   ~/.dsh/profiles/<name>/                     created, then deleted
 *   <scratch>/runtime/                          the DSH tree extracted from app.asar
 *   <scratch>/probe.js, probe.patch.yml         the read-only Host probe
 *
 * The runtime is extracted from the installed Electron archive because a plain
 * Node process cannot resolve modules from inside `app.asar`, and the unpacked
 * native binaries are restored beside it for the same reason.
 *
 *   node evidence/e2e.mjs [--keep] [--port 19490]
 *
 * `--keep` leaves the profile and the scratch runtime in place for inspection.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const workspace = join(packageRoot, '..')

const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const portArg = argv.indexOf('--port')
const port = portArg >= 0 ? Number(argv[portArg + 1]) : 19490

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const PACKAGE = manifest.name
const PROFILE_NAME = 'dsh-git-guard-e2e'
const SCRATCH = join(tmpdir(), 'dsh-git-guard-e2e')
const RUNTIME = join(SCRATCH, 'runtime')
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles', PROFILE_NAME)
const APP_ASAR = process.env.DSH_E2E_ASAR ?? 'C:/Users/Yokira/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
const NODE = process.env.DSH_E2E_NODE ?? process.execPath
const TOOLS = join(workspace, '_tools')

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (pass ? '' : '  (' + detail + ')'))
}

/* ───────────────────────────── 1. scratch setup ───────────────────────── */

function run(label, args, options = {}) {
  const result = spawnSync(NODE, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    console.log('  [' + label + '] exit ' + result.status)
    if (result.stdout) console.log(result.stdout.slice(-2000))
    if (result.stderr) console.log(result.stderr.slice(-2000))
  }
  return result
}

rmSync(PROFILE_DIR, { recursive: true, force: true })
mkdirSync(PROFILE_DIR, { recursive: true })
mkdirSync(SCRATCH, { recursive: true })

/* The plugin is a copy, not a link: a junction would let the client-modules scan
   reach every file in the authoring directory, which is not what a release is. */
const copy = spawnSync('robocopy', [packageRoot, join(PROFILE_DIR, 'node_modules', '@yokira404', 'dsh-git-guard'), '/E', '/XD', 'node_modules', '.git'], { encoding: 'utf8' })
check('the plugin copies into the profile', existsSync(join(PROFILE_DIR, 'node_modules', '@yokira404', 'dsh-git-guard', 'package.json')), 'robocopy status ' + copy.status)

writeFileSync(
  join(PROFILE_DIR, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-git-guard-e2e',
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PACKAGE] } },
      dependencies: { [PACKAGE]: 'file:./node_modules/@yokira404/dsh-git-guard' },
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

writeFileSync(
  join(SCRATCH, 'probe.patch.yml'),
  [
    '- insert:',
    '    - id: gg-probe',
    "      name: '" + join(TOOLS, 'gg-probe.js').replace(/\\/g, '/') + "'",
    '      config: {}',
    "    - id: tool-bash",
    "      name: '@deepseek-ai/dsh-tool-bash'",
    '      config: {}',
    '- id: office-to-pdf',
    '  disabled: true',
    '',
  ].join('\n'),
  'utf8',
)

/* ─────────────────────── 2. the runtime, extracted ────────────────────── */

if (existsSync(join(RUNTIME, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')) === false) {
  if (existsSync(APP_ASAR) === false) {
    console.log('SKIP  the installed app.asar was not found at ' + APP_ASAR)
    process.exit(0)
  }
  console.log('extracting the DSH runtime from app.asar (one time, ~110 MB)')
  run('extract', [join(TOOLS, 'asar-extract-tree.mjs'), APP_ASAR, 'dsh', RUNTIME])
  run('unpacked', [join(TOOLS, 'asar-restore-unpacked.mjs'), APP_ASAR, 'dsh', RUNTIME, '--skip', 'libreoffice', '--skip', 'sherpa-onnx'])
}
check('the runtime anchor exists', existsSync(join(RUNTIME, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')), RUNTIME)
check('the native loader addon was restored', existsSync(join(RUNTIME, 'node_modules', 'node-addon-require-builtin-win32-x64-msvc', 'prebuilt', 'win32-x64-msvc-napi-v9.node')), 'unpacked restore')

/* ───────────────────────────── 3. boot the Host ───────────────────────── */

const bin = join(RUNTIME, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const logPath = join(SCRATCH, 'boot.log')
const log = []
/*
 * A stale Host from an interrupted earlier run would keep the port and answer in
 * place of this one — which is exactly how a suite starts reporting on code it is
 * no longer running. The port is freed first, and the boot is made to prove its
 * identity through `GG_BOOT_TOKEN` so a stranger on the port fails the wait
 * instead of silently answering it.
 */
function freePort() {
  if (process.platform !== 'win32') return
  const listing = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -like \'*' + PROFILE_NAME + '*\' } | Select-Object -ExpandProperty ProcessId'], { encoding: 'utf8' })
  for (const line of String(listing.stdout ?? '').split(/\r?\n/)) {
    const pid = Number(line.trim())
    if (Number.isInteger(pid) === true && pid > 0) {
      try {
        process.kill(pid, 'SIGKILL')
        console.log('  freed port: killed stale host pid ' + pid)
      } catch {
        /* already gone */
      }
    }
  }
}
freePort()

const BOOT_TOKEN = 'e2e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
const child = spawn(NODE, [bin, '--profile', PROFILE_NAME, '--patch', join(SCRATCH, 'probe.patch.yml'), '--port', String(port), '--no-open'], {
  cwd: SCRATCH,
  /* The probe creates its agents in a directory that exists; see `GG_PROBE_CWD`. */
  env: { ...process.env, GG_BOOT_TOKEN: BOOT_TOKEN, GG_PROBE_CWD: SCRATCH },
})
child.stdout.on('data', (chunk) => log.push(String(chunk)))
child.stderr.on('data', (chunk) => log.push(String(chunk)))
child.on('exit', (code) => log.push('[exit ' + code + ']'))

const base = 'http://127.0.0.1:' + port
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(path, init) {
  const response = await fetch(base + path, init)
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text) }
  } catch {
    return { status: response.status, body: text }
  }
}

async function waitForBoot(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastSeen = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null
    try {
      const probe = await getJson('/gg-probe')
      if (probe.status === 200 && probe.body?.ok === true) {
        lastSeen = probe.body
        if (probe.body.bootToken === BOOT_TOKEN) return probe.body
      }
    } catch {
      /* not listening yet */
    }
    await sleep(1000)
  }
  if (lastSeen !== null) {
    console.log('  the port is answering, but not from this boot (token ' + JSON.stringify(lastSeen.bootToken) + ' vs ' + JSON.stringify(BOOT_TOKEN) + ')')
  }
  return null
}

const probe = await waitForBoot(180000)
writeFileSync(logPath, log.join(''), 'utf8')
check('the Host boots with the plugin as a profile bundle', probe !== null, 'no probe answer; see ' + logPath)

if (probe === null) {
  console.log('\nboot log:\n' + log.join('').slice(-3000))
} else {
  check('every plugin row activated (no failed entries)', probe.failed.length === 0, JSON.stringify(probe.failed))
  check('the git-guard row is present', probe.gitGuard.length === 1, JSON.stringify(probe.gitGuard))
  check('the git-guard row is active', probe.gitGuard[0]?.stateName === 'active', JSON.stringify(probe.gitGuard[0]))
  check('the git-guard row resolves every service it injects', (probe.gitGuard[0]?.missingServices ?? ['x']).length === 0, JSON.stringify(probe.gitGuard[0]?.missingServices))
  check('the guard service is published', probe.guardService?.version === manifest.version, JSON.stringify(probe.guardService))

  /* ───────────────────── 4. the Client half is served ─────────────────── */

  const bundle = await getJson('/gg-bundle')
  check('the Client half is composed into the boot graph', bundle.body?.graphEntry?.id === PACKAGE, JSON.stringify(bundle.body?.graphEntry))
  check('the Client half is served at the URL the graph advertises', bundle.body?.served?.status === 200, JSON.stringify(bundle.body?.served))
  check('the served bundle draws into the Session header utilities row', bundle.body?.served?.hasHeader === true, JSON.stringify(bundle.body?.served))
  check('the served bundle talks to the Host route', bundle.body?.served?.hasRoute === true, JSON.stringify(bundle.body?.served))
  check('the served bundle registers with the module loader', bundle.body?.served?.hasLoaderCall === true, JSON.stringify(bundle.body?.served))
  /*
   * The bytes that reach a browser carry the same click rules as the Host half. This
   * is the one place the *shipped* artifact is read rather than the source, so it is
   * also the check that a stale bundle is not being served.
   */
  check('the served bundle carries the click rules', bundle.body?.served?.hasNextState === true, JSON.stringify(bundle.body?.served))
  check('the served bundle is this version', bundle.body?.served?.version === manifest.version, JSON.stringify({ served: bundle.body?.served?.version, manifest: manifest.version }))

  /* ─────────────────── 5. the live pipeline obeys the switches ─────────── */

  /*
   * A Session id unique to this run. The Host's Session store is durable and keyed
   * by working directory, so a fixed id would collide with the previous run's
   * leftover and the probe would report "no agent" instead of the behaviour under
   * test — a suite that reads as a plugin failure when it is really its own litter.
   */
  const SESSION = 'e2e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

  const dispatch = async (command) => {
    const result = await getJson('/gg-dispatch?session=' + SESSION + '&command=' + encodeURIComponent(command))
    const body = result.body
    if (body === null || typeof body !== 'object' || body.ok === undefined) {
      console.log('  [dispatch] ' + command + ' -> HTTP ' + result.status + ' body=' + JSON.stringify(body).slice(0, 600))
    }
    return {
      isError: body?.isError,
      code: body?.errorCode,
      reason: body?.errorReason,
      message: body?.errorMessage,
      text: body?.firstText,
      dispatchedAs: body?.dispatchedAs,
    }
  }
  const setSwitches = async (local, remote) => {
    const result = await getJson('/gg-write?session=' + SESSION + '&local=' + (local ? 1 : 0) + '&remote=' + (remote ? 1 : 0))
    return result.body?.state
  }

  /*
   * `git status` is the positive control, and it has to be a *real* call: the probe
   * session's working directory is not a repository, so a Host that reached the
   * tool answers with git's own "not a git repository" on stderr. The check
   * therefore asserts *that output*, not merely the absence of a guard code — an
   * error from anywhere else in the pipeline is not evidence of anything.
   */
  await setSwitches(true, true)
  const control = await dispatch('git status')
  const controlRan = typeof control.text === 'string' && control.text.includes('not a git repository')
  check('the positive control runs the real tool', controlRan, JSON.stringify(control))

  const localBlocked = await dispatch('git commit -m x')
  check('a local write is blocked while the left switch is on', localBlocked.code === 'DSH_GIT_GUARD_BLOCKED' && localBlocked.reason === 'local', JSON.stringify(localBlocked))
  const remoteBlocked = await dispatch('git push origin main')
  check('an upload is blocked while the right switch is on', remoteBlocked.code === 'DSH_GIT_GUARD_BLOCKED' && remoteBlocked.reason === 'remote', JSON.stringify(remoteBlocked))
  const ghBlocked = await dispatch('gh repo create x/y --private')
  check('a gh call is blocked while the right switch is on', ghBlocked.code === 'DSH_GIT_GUARD_BLOCKED' && ghBlocked.reason === 'remote', JSON.stringify(ghBlocked))
  const readAllowed = await dispatch('git log --oneline -3')
  check('reading the repository is never blocked', readAllowed.code === null, JSON.stringify(readAllowed))

  /*
   * Enforcement over all four switch states. The *clicks* that produce these states
   * cannot happen here — a click is a browser event, and `selftest.mjs` owns the
   * exhaustive truth table for them. What this suite proves is the half that needs a
   * live Host: each state means what it says at the tool pipeline.
   */
  const localOnly = await setSwitches(true, false)
  check('local on with remote off is stored as sent', localOnly?.local === true && localOnly?.remote === false, JSON.stringify(localOnly))
  const localOnlyCommit = await dispatch('git commit -m x')
  const localOnlyPush = await dispatch('git push origin main')
  check('with only the left switch on a commit is blocked', localOnlyCommit.reason === 'local', JSON.stringify(localOnlyCommit))
  check('with only the left switch on a push passes', localOnlyPush.code === null, JSON.stringify(localOnlyPush))

  /*
   * The reported bug, pinned: the left switch must be storable as off — including
   * right after it was on — rather than repaired back to armed on the way through.
   */
  const bothOff = await setSwitches(false, false)
  check('the left switch can be switched off while the right one is off', bothOff?.local === false && bothOff?.remote === false, JSON.stringify(bothOff))
  const offCommit = await dispatch('git commit -m x')
  const offPush = await dispatch('git push origin main')
  check('with both switches off a commit passes', offCommit.code === null, JSON.stringify(offCommit))
  check('with both switches off a push passes', offPush.code === null, JSON.stringify(offPush))

  const remoteOnly = await setSwitches(false, true)
  check('local off with remote on is stored as sent', remoteOnly?.local === false && remoteOnly?.remote === true, JSON.stringify(remoteOnly))
  const remoteOnlyCommit = await dispatch('git commit -m x')
  const remoteOnlyPush = await dispatch('git push origin main')
  check('with the left switch off a commit passes', remoteOnlyCommit.code === null, JSON.stringify(remoteOnlyCommit))
  check('while the right switch still refuses the push', remoteOnlyPush.reason === 'remote', JSON.stringify(remoteOnlyPush))

  await setSwitches(true, true)
  const armedCommit = await dispatch('git commit -m x')
  const armedPush = await dispatch('git push origin main')
  check('re-arming both switches blocks both again', armedCommit.reason === 'local' && armedPush.reason === 'remote', JSON.stringify({ armedCommit, armedPush }))

  /* ───────────────── 6. the route the Client really calls ─────────────── */

  const routeSession = 'e2e-route-' + Date.now().toString(36)
  const read = await getJson('/dsh-git-guard/state?session=' + routeSession)
  check('the Client route answers a GET', read.status === 200 && read.body?.ok === true, JSON.stringify(read.body))
  check('an unreported Session reads as armed', read.body?.state?.local === true && read.body?.state?.remote === true, JSON.stringify(read.body?.state))
  const wrote = await getJson('/dsh-git-guard/state?session=' + routeSession, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { local: false, remote: false } }),
  })
  check('the route stores both-off as sent', wrote.body?.state?.local === false && wrote.body?.state?.remote === false, JSON.stringify(wrote.body?.state))
  const wroteAgain = await getJson('/dsh-git-guard/state?session=' + routeSession, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { local: false, remote: false } }),
  })
  check('a repeated local-off write is not repaired back on', wroteAgain.body?.state?.local === false, JSON.stringify(wroteAgain.body?.state))
  const keptIndependent = await getJson('/dsh-git-guard/state?session=' + routeSession, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { local: false, remote: true } }),
  })
  check('the route keeps local-off with remote-on as sent', keptIndependent.body?.state?.local === false && keptIndependent.body?.state?.remote === true, JSON.stringify(keptIndependent.body?.state))
  const badMethod = await getJson('/dsh-git-guard/state?session=' + routeSession, { method: 'DELETE' })
  check('the Client route refuses an unsupported method', badMethod.status === 405, String(badMethod.status))
  const badJson = await getJson('/dsh-git-guard/state?session=' + routeSession, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
  check('the Client route refuses malformed JSON', badJson.status === 400, String(badJson.status))
}

/* ───────────────────────────── 7. teardown ────────────────────────────── */

child.kill()
await sleep(1500)
if (child.exitCode === null) child.kill('SIGKILL')

if (keep !== true) {
  rmSync(PROFILE_DIR, { recursive: true, force: true })
  /*
   * The Host keys its Session store by the working directory a Session was created
   * in, so this run's probe Sessions are already isolated under a directory name of
   * their own. Both spellings are removed anyway: leaving them behind would make a
   * later run's fixed ids collide, and the mess is entirely ours.
   */
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  for (const entry of existsSync(sessionsRoot) === true ? readdirSync(sessionsRoot) : []) {
    if (entry.includes('dsh-git-guard-e2e') === true) {
      rmSync(join(sessionsRoot, entry), { recursive: true, force: true })
    }
  }
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log('\ncleaned up ' + PROFILE_DIR + ', its Session records and ' + SCRATCH)
} else {
  console.log('\nkept ' + PROFILE_DIR + ' and ' + SCRATCH)
}

const failed = checks.filter((entry) => entry.pass !== true).length
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
