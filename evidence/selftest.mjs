/**
 * Behavioural suite for @yokira404/dsh-git-guard.
 *
 * It drives the *shipped* rules, not a paraphrase of them: `classifyShellCommand`,
 * `classifyCall`, `normalizeState`, `decide` and the denial text are the very
 * values `index.js` exports to the Cordis loader, and the `apply` section at the
 * end runs the real `apply()` against a stub Host context, then calls the listener
 * and the route handler it actually installed.
 *
 * That last part is the point. "DSH must still start" is not a claim a syntax check
 * can make: a Cordis row whose `apply` throws is a boot failure, and a row whose
 * `apply` is missing altogether is a row that silently does nothing. Both are
 * covered here, plus the route the Client writes to, since a Client switch that
 * cannot reach its route would look alive and guard nothing.
 *
 *   node evidence/selftest.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
/** The workspace this package sits in; some checks read shared tooling from it. */
const workspace = join(root, '..')
const mod = await import(new URL('../index.js', import.meta.url).href)
const { apply, classifyShellCommand, classifyCall, commandTexts, normalizeState, decide, denialMessage, shellWords, nextState, DEFAULT_STATE, VERSION } = mod

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const eq = (name, actual, expected) => check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))

/* ───────────────────────────── 1. the shape ───────────────────────────── */

check('the module exports apply', typeof apply === 'function', typeof apply)
check('the module exports the classifier', typeof classifyShellCommand === 'function', typeof classifyShellCommand)
/*
 * The version is asserted against the module, and the manifest is checked against it
 * in section 15, so a release cannot ship the two out of step.
 */
eq('the version is declared', VERSION, '1.0.1')
check('both switches default to on', DEFAULT_STATE.local === true && DEFAULT_STATE.remote === true, JSON.stringify(DEFAULT_STATE))

/* ─────────────────────── 2. the local half is blocked ─────────────────── */

const LOCAL_CASES = [
  'git add -A',
  'git add .',
  'git commit -m "wip"',
  'git commit --amend --no-edit',
  'git config user.email "a@b.c"',
  'git config --global core.autocrlf false',
  'git config --global remote.origin.url https://github.com/x/y.git',
  'git stash',
  'git stash push -m save',
  'git reset --hard HEAD~1',
  'git revert HEAD',
  'git merge feature',
  'git rebase main',
  'git rm -r --cached node_modules',
  'git mv a b',
  'git tag v1.0.0',
  'git switch -c feature',
  'git apply patch.diff',
  'git -C /home/user/repo add .',
  'git -C /home/user/repo commit -m x',
  'git --git-dir=/home/user/repo/.git commit -m x',
  'git update-ref refs/heads/main HEAD',
  'sudo git commit -m x',
  'env FOO=1 git add .',
]
for (const command of LOCAL_CASES) {
  eq('local: ' + command, classifyShellCommand(command), 'local')
}

/* ────────────────────── 3. the remote half is blocked ─────────────────── */

const REMOTE_CASES = [
  'git push',
  'git push origin main',
  'git push --force-with-lease origin HEAD',
  'git push -u origin main',
  'git pull',
  'git pull --rebase origin main',
  'git fetch --all',
  'git remote add origin https://github.com/x/y.git',
  'git remote -v',
  'git remote set-url origin git@github.com:x/y.git',
  'git clone https://github.com/x/y.git',
  'git clone git@github.com:x/y.git /tmp/y',
  'git ls-remote origin',
  'git submodule update --init',
  'git -c user.name=x push',
  'gh repo create x/y --private',
  'gh pr create --fill',
  'gh release create v1.0.0',
  'gh api -X POST /repos/x/y/git/refs',
  'gh api /repos/x/y/pulls',
  'gh api /user/repos',
  'gh api /orgs/my-org/repos',
  'gh gist create notes.md',
  'curl -X POST https://api.github.com/repos/x/y/issues',
  'wget --post-file=x https://github.com/upload',
  'Invoke-RestMethod -Uri https://github.com/x/y -Method Post',
  'cd /repo && git push origin main',
  'git add -A && git commit -m x && git push',
  'git status && git push',
  'C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe push origin main',
  'git.exe push',
  'git push origin main 2>&1 | cat',
]
for (const command of REMOTE_CASES) {
  eq('remote: ' + command, classifyShellCommand(command), 'remote')
}

/* ───────────────────────── 4. everything else is free ─────────────────── */

const ALLOWED_CASES = [
  'git status',
  'git status --short',
  'git log --oneline -20',
  'git diff HEAD',
  'git show HEAD',
  'git init',
  'git init -b main',
  'git branch',
  'git branch --list',
  'git describe --tags',
  'git rev-parse HEAD',
  'git check-ignore -v node_modules/',
  'git ls-files',
  'git blame src/index.js',
  'git worktree list',
  'git help commit',
  'git --version',
  'gh --version',
  'gh auth status',
  'gh auth login',
  'gh config list',
  'gh completion -s bash',
  'gh api /user',
  'gh api -X GET /user',
  'gh api /users/octocat',
  'gh help pr',
  'npm install',
  'npm run build',
  'node evidence/selftest.mjs',
  'mkdir -p /home/user/app',
  'ls -la /home/user/repo',
  'cat /home/user/repo/README.md',
  'curl https://example.com/data.json',
  'curl -sSL https://registry.npmjs.org/react',
  'echo "git push is a command"',
  'grep -rn "git push" docs/',
  'rg "gh pr create" .',
]
for (const command of ALLOWED_CASES) {
  eq('allowed: ' + command, classifyShellCommand(command), null)
}

/* ─────────────────── 5. text that only mentions the verbs ─────────────── */

/*
 * The false-positive set that matters most: a commit message explaining why a
 * push is dangerous is still a commit, and a test file full of `git push` strings
 * is still a file being written. Only real words may count.
 */
const QUOTED_CASES = [
  ['git commit -m "do not push this"', 'local'],
  ['git commit -m "never run git remote add"', 'local'],
  ['git commit -m "fixed: git push failed"', 'local'],
  ["git commit -m 'gh pr create is not needed'", 'local'],
  ['echo "git push origin main" > notes.txt', null],
  ['printf "git commit -m x" >> log.md', null],
  ['git tag -a v1 -m "release: do not push yet"', 'local'],
]
for (const [command, expected] of QUOTED_CASES) {
  eq('quoted: ' + command, classifyShellCommand(command), expected)
}

/* ──────────────────────── 6. tool-call classification ─────────────────── */

const CALL_CASES = [
  [{ command: 'git push origin main' }, 'remote'],
  [{ command: 'git commit -m x' }, 'local'],
  [{ command: 'git status' }, null],
  [{ script: 'git push' }, 'remote'],
  [{ code: 'subprocess.run(["git", "push"])' }, null],
  [{ command: 'ls -la' }, null],
  [{ description: 'push it', command: 'git add .' }, 'local'],
  [{}, null],
  [null, null],
  [undefined, null],
  ['a string, not an object', null],
  [{ command: ['git status', 'git push'] }, 'remote'],
  [{ command: 'git add .', script: 'git push' }, 'remote'],
  [{ command: 'git add .', script: 'git commit -m x' }, 'local'],
]
for (const [args, expected] of CALL_CASES) {
  const found = classifyCall(args)
  eq('call ' + JSON.stringify(args) + ' -> ' + String(expected), found === null ? null : found.operation, expected)
}

/* ────────────────────────── 7. the switch rule ────────────────────────── */

/*
 * Every switch answers for its own half and nothing else, so all four combinations
 * are reachable states rather than a table with holes in it. `local` off with
 * `remote` on is the one that proves the independence: local writes pass while the
 * upload stays blocked.
 */
const RULES = [
  [{ local: true, remote: true }, 'local', 'local'],
  [{ local: true, remote: true }, 'remote', 'remote'],
  [{ local: true, remote: false }, 'local', 'local'],
  [{ local: true, remote: false }, 'remote', null],
  [{ local: false, remote: true }, 'local', null],
  [{ local: false, remote: true }, 'remote', 'remote'],
  [{ local: false, remote: false }, 'local', null],
  [{ local: false, remote: false }, 'remote', null],
]
for (const [state, operation, expected] of RULES) {
  eq('decide ' + JSON.stringify(state) + ' on ' + operation, decide(state, { operation }), expected)
}

/* ───────────────────────── 8. normalisation holds ─────────────────────── */

/*
 * Normalisation is type repair and nothing else: every combination of the two
 * switches is a real, storable state. The pair's one behavioural rule is a property
 * of the gesture that switches the remote guard off, and is asserted where that
 * gesture lives (section 14 reads the Client's `toggleRemote`).
 *
 * Encoding the rule here as an invariant was a real bug worth this comment: it made
 * `local: false` unrepairable-to-storable while the remote switch was off, so the
 * local switch snapped back on every time it was switched off.
 */
eq('local off with remote off is kept, not repaired', JSON.stringify(normalizeState({ local: false, remote: false })), JSON.stringify({ local: false, remote: false }))
eq('local off with remote on is kept', JSON.stringify(normalizeState({ local: false, remote: true })), JSON.stringify({ local: false, remote: true }))
eq('both on survives', JSON.stringify(normalizeState({ local: true, remote: true })), JSON.stringify({ local: true, remote: true }))
eq('local on with remote off is kept', JSON.stringify(normalizeState({ local: true, remote: false })), JSON.stringify({ local: true, remote: false }))
eq('junk falls back to the armed default', JSON.stringify(normalizeState({ local: 'nonsense', remote: 7 })), JSON.stringify({ local: true, remote: true }))
eq('null falls back to the armed default', JSON.stringify(normalizeState(null)), JSON.stringify(DEFAULT_STATE))
eq('undefined falls back to the armed default', JSON.stringify(normalizeState(undefined)), JSON.stringify(DEFAULT_STATE))
eq('false strings from the wire are understood', JSON.stringify(normalizeState({ local: 'false', remote: 'false' })), JSON.stringify({ local: false, remote: false }))
eq('mixed strings are understood', JSON.stringify(normalizeState({ local: 'true', remote: 'false' })), JSON.stringify({ local: true, remote: false }))
eq('a missing field takes the armed default', JSON.stringify(normalizeState({ local: false })), JSON.stringify({ local: false, remote: true }))

/* ──────────────────── 8b. the whole click truth table ─────────────────── */

/*
 * Every cell of the pair's behaviour, as specified. There are only two clicks and
 * four states, so the table is exhaustive rather than illustrative — and writing it
 * out is what stops a "rule" being derived from it by intuition, which is exactly
 * how an earlier revision locked the local switch on.
 *
 *   clicking the local switch   toggles it; landing ON turns the remote switch on
 *                               too, landing OFF leaves the remote switch alone;
 *   clicking the remote switch  toggles it; landing OFF turns the local switch off
 *                               too, landing ON leaves the local switch alone.
 *
 * Note the asymmetry, because it is the whole design: the two clicks carry each
 * other in *opposite* directions. Reading it off the action ("clicking a switch
 * moves the other one") gets both the direction and the condition wrong.
 */
const CLICKS = [
  /* [state, clicked, expected, why] */
  [{ local: true, remote: true }, 'local', { local: false, remote: true }, 'the default pair: local off, the remote switch unmoved'],
  [{ local: true, remote: true }, 'remote', { local: false, remote: false }, 'the default pair: switching remote off carries local off with it'],
  [{ local: false, remote: true }, 'remote', { local: false, remote: false }, 'remote switched off while local is already off'],
  [{ local: false, remote: true }, 'local', { local: true, remote: true }, 'local switched on carries the remote switch with it'],
  [{ local: false, remote: false }, 'remote', { local: false, remote: true }, 'remote switched on asks for nothing else while local is off'],
  [{ local: false, remote: false }, 'local', { local: true, remote: true }, 'switching local on from both-off turns both on'],
  [{ local: true, remote: false }, 'remote', { local: true, remote: true }, 'remote switched back on leaves local alone'],
  [{ local: true, remote: false }, 'local', { local: false, remote: false }, 'local switched off leaves the remote switch alone'],
]
for (const [state, clicked, expected, why] of CLICKS) {
  eq(
    'click ' + clicked + ' from ' + JSON.stringify(state) + ' -> ' + JSON.stringify(expected) + ' (' + why + ')',
    JSON.stringify(nextState(state, clicked)),
    JSON.stringify(expected),
  )
}

/*
 * The properties that make the pair usable, stated over the table rather than
 * assumed:
 *
 *   reachability   every combination is reachable and nothing is ever locked: the
 *                  reader can always get to any pairing, in either direction, and no
 *                  click is a no-op that looks like a switch snapping back;
 *   the carrying   each click carries the other switch in exactly one direction —
 *                  the left one when it lands ON, the right one when it lands OFF —
 *                  so a guard over uploads can never be *asked for* over an
 *                  unguarded repository. This is a rule about the gesture, which is
 *                  why it is asserted as a property of `nextState` and deliberately
 *                  not as an invariant of the stored pair: `local off · remote on`
 *                  is a perfectly storable state (reached by switching the local
 *                  guard off, and the one the reader said must *not* follow from a
 *                  right-hand click).
 */
{
  const states = [
    { local: true, remote: true },
    { local: true, remote: false },
    { local: false, remote: true },
    { local: false, remote: false },
  ]
  /* Walk the table outward from *every* state, following every click, to show no
   * state traps the reader: each one is reachable from the armed default and can be
   * left again. Seeding the walk with all four and following the transitions is what
   * checks that; seeding only the default would report reachability of the default's
   * own successors and nothing about the rest. */
  const nodes = new Map(states.map((state) => [JSON.stringify(state), state]))
  const frontier = [...nodes.values()]
  for (let index = 0; index < frontier.length; index += 1) {
    const from = frontier[index]
    for (const clicked of ['local', 'remote']) {
      const to = nextState(from, clicked)
      if (nodes.has(JSON.stringify(to))) continue
      nodes.set(JSON.stringify(to), to)
      frontier.push(to)
    }
  }
  eq('every state is reachable by clicking', nodes.size, 4)
  /* Every click is a real move, and the switch that was clicked always really flips. */
  for (const from of states) {
    for (const clicked of ['local', 'remote']) {
      const to = nextState(from, clicked)
      check('clicking ' + clicked + ' from ' + JSON.stringify(from) + ' changes the pair', to.local !== from.local || to.remote !== from.remote, JSON.stringify(to))
      eq('the clicked switch always flips (' + clicked + ' from ' + JSON.stringify(from) + ')', to[clicked], from[clicked] !== true)
    }
  }
  /*
   * The direction each click carries the other switch, checked in every state:
   * the left click carries the remote guard when it lands on, and the right click
   * carries the local guard when it lands off — and only then.
   */
  for (const from of states) {
    const localOn = nextState(from, 'local')
    if (localOn.local === true) {
      eq('the local click carries the remote guard on (' + JSON.stringify(from) + ')', localOn.remote, true)
    } else {
      eq('the local click leaves the remote guard alone when it lands off (' + JSON.stringify(from) + ')', localOn.remote, from.remote)
    }
    const remoteOn = nextState(from, 'remote')
    if (remoteOn.remote === false) {
      eq('the remote click releases the local guard (' + JSON.stringify(from) + ')', remoteOn.local, false)
    } else {
      eq('the remote click leaves the local guard alone when it lands on (' + JSON.stringify(from) + ')', remoteOn.local, from.local)
    }
  }
  /*
   * The cell the reader reported: with both switches on, a right-hand click turns
   * both off rather than leaving the local guard behind.
   */
  eq(
    'both on + the right switch turns both off',
    JSON.stringify(nextState({ local: true, remote: true }, 'remote')),
    JSON.stringify({ local: false, remote: false }),
  )
  /*
   * The rule for the right switch, as a property of the click rather than of a state:
   * it moves itself and releases the local guard with itself when it lands off, and
   * it never asks for anything else. So a right-hand click either turns the remote
   * guard off, taking the local guard down with it, or turns the remote guard on
   * while every other switch stays exactly where it was.
   */
  check(
    'the rule for the right switch holds from every state',
    states.every((from) => {
      const to = nextState(from, 'remote')
      return to.remote === false ? to.local === false : to.local === from.local
    }),
    JSON.stringify(states.map((from) => nextState(from, 'remote'))),
  )
  /*
   * The cell the reader reported, spelled out: with both switches on, a right-hand
   * click turns both off rather than leaving the local guard behind.
   */
  eq(
    'both on + the right switch turns both off',
    JSON.stringify(nextState({ local: true, remote: true }, 'remote')),
    JSON.stringify({ local: false, remote: false }),
  )
  /*
   * And the other half of the reader's answer, spelled out too, because it is the
   * mirror image and the one an "obviously symmetric" implementation gets wrong: with
   * both switches off, a right-hand click arms the upload guard alone. Only the local
   * guard being switched *off* releases the upload guard; asking for the upload guard
   * asks for nothing else, and the pairing `local off · remote on` is therefore a
   * state the pair can be in deliberately, not a hole.
   */
  eq(
    'both off + the right switch arms the upload guard alone',
    JSON.stringify(nextState({ local: false, remote: false }, 'remote')),
    JSON.stringify({ local: false, remote: true }),
  )
  check(
    'the right switch leaves the local guard untouched unless it lands off',
    states.every((from) => {
      const to = nextState(from, 'remote')
      return to.remote === true ? to.local === from.local : true
    }),
    JSON.stringify(states.map((from) => nextState(from, 'remote'))),
  )
}

/* ─────────────────────────── 9. the refusal text ──────────────────────── */

const localText = denialMessage('local', 'git commit -m x')
const remoteText = denialMessage('remote', 'git push origin main')
check('the local refusal names the left switch', localText.includes('左侧'), localText.slice(0, 40))
check('the remote refusal names the right switch', remoteText.includes('右侧'), remoteText.slice(0, 40))
check('the refusal quotes the command it stopped', remoteText.includes('git push origin main'), remoteText)
check('the refusal tells the model not to work around it', remoteText.includes('绕过'), remoteText)
check('the refusal tells the model not to switch the guard off', remoteText.includes('关闭该开关'), remoteText)
check('the refusal mentions the blocked item is not done', remoteText.includes('未执行'), remoteText)
check('a refusal with no evidence still reads', denialMessage('local', null).includes('已阻止'), denialMessage('local', null))
check('a very long command is truncated', denialMessage('remote', 'x'.repeat(5000)).length < 1200, String(denialMessage('remote', 'x'.repeat(5000)).length))

/* ───────────────────────────── 10. the tokenizer ──────────────────────── */

eq('quotes keep a phrase whole', JSON.stringify(shellWords('git commit -m "a b c"')), JSON.stringify(['git', 'commit', '-m', 'a b c']))
eq('single quotes too', JSON.stringify(shellWords("gh pr create --title 'fix: x'")), JSON.stringify(['gh', 'pr', 'create', '--title', 'fix: x']))
eq('an empty command has no words', JSON.stringify(shellWords('   ')), JSON.stringify([]))

/* ──────────────────────── 11. the Host half applies ───────────────────── */

const listeners = []
const routes = []
const provided = []
const effects = []

/** `ctx.inject` hands back a scoped Context: the same verbs, plus the service. */
const scopedCtx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect(callback, label) {
    effects.push({ label, disposer: callback() })
    return () => {}
  },
  on: () => () => {},
  provide: () => () => {},
  get: () => undefined,
}

const stubCtx = {
  on(name, listener) {
    listeners.push({ name, listener })
    return () => {}
  },
  inject(names, callback) {
    callback(scopedCtx)
    return () => {}
  },
  effect(callback) {
    callback()
    return () => {}
  },
  provide(name, value) {
    provided.push({ name, value })
    return () => {}
  },
  get: () => undefined,
}

let applied = true
try {
  apply(stubCtx)
} catch (error) {
  applied = false
  check('apply() does not throw', false, error && error.message ? error.message : String(error))
}
check('apply() does not throw', applied, 'apply() threw')
eq('it installs exactly one pipeline listener', listeners.length, 1)
eq('on the documented pre-dispatch event', listeners[0]?.name, 'tools/pre-execute')
check('the listener is async', listeners[0]?.listener?.constructor?.name === 'AsyncFunction', listeners[0]?.listener?.constructor?.name)
eq('it registers exactly one route', routes.length, 1)
eq('the route is exact', routes[0]?.kind, 'exact')
eq('the route is the one the Client writes to', routes[0]?.path, '/dsh-git-guard/state')
check('the route has a handler', typeof routes[0]?.handler === 'function', typeof routes[0]?.handler)
eq('it publishes one diagnostic service', provided.length, 1)
eq('under the package name', provided[0]?.name, 'dsh-git-guard')

/* ─────────────── 12. the installed listener really denies ─────────────── */

const listener = listeners[0]?.listener
const allowed = () => ({ kind: 'allow' })
const sessionOf = (id) => ({ agent: { id } })

async function run(exec) {
  return await listener(exec, allowed)
}

if (typeof listener === 'function') {
  const push = await run({ name: 'bash', arguments: { command: 'git push origin main' }, ...sessionOf('s1') })
  eq('an unreported session is armed against a push', push?.kind, 'deny')
  eq('and the denial names the remote switch', push?.info?.reason, 'remote')
  eq('with a stable error code', push?.info?.code, 'DSH_GIT_GUARD_BLOCKED')

  const commit = await run({ name: 'bash', arguments: { command: 'git commit -m x' }, ...sessionOf('s1') })
  eq('the same session blocks a commit', commit?.kind, 'deny')
  eq('naming the local switch', commit?.info?.reason, 'local')

  const status = await run({ name: 'bash', arguments: { command: 'git status' }, ...sessionOf('s1') })
  eq('a read passes through untouched', status?.kind, 'allow')

  const noAgent = await run({ name: 'bash', arguments: { command: 'git push' } })
  eq('a call with no agent is still guarded', noAgent?.kind, 'deny')

  /* The state the Client writes is the state enforcement reads. */
  provided[0]?.value?.write('s1', { local: true, remote: false })
  const remoteOff = await run({ name: 'bash', arguments: { command: 'git push origin main' }, ...sessionOf('s1') })
  eq('switching the remote guard off lets a push through', remoteOff?.kind, 'allow')
  const remoteOffCommit = await run({ name: 'bash', arguments: { command: 'git commit -m x' }, ...sessionOf('s1') })
  eq('and the local guard it re-armed now blocks a commit', remoteOffCommit?.kind, 'deny')

  provided[0]?.value?.write('s1', { local: false, remote: false })
  const bothOff = await run({ name: 'bash', arguments: { command: 'git push origin main' }, ...sessionOf('s1') })
  eq('with both off a push passes', bothOff?.kind, 'allow')

  /*
   * The independence in one assertion: releasing the local guard leaves the remote
   * guard exactly where it was, so a push is still refused while a commit is not.
   */
  provided[0]?.value?.write('s1', { local: false, remote: true })
  const kept = provided[0]?.value?.stateOf('s1')
  eq('local off with remote on is stored as sent', JSON.stringify(kept), JSON.stringify({ local: false, remote: true }))
  const keptCommit = await run({ name: 'bash', arguments: { command: 'git add .' }, ...sessionOf('s1') })
  eq('and a local write now passes', keptCommit?.kind, 'allow')
  const keptPush = await run({ name: 'bash', arguments: { command: 'git push' }, ...sessionOf('s1') })
  eq('while the upload is still refused', keptPush?.kind, 'deny')
  eq('by the remote switch', keptPush?.info?.reason, 'remote')

  /* Another session keeps its own switches: the guard is per Session. */
  provided[0]?.value?.write('s2', { local: true, remote: true })
  const other = await run({ name: 'bash', arguments: { command: 'git push' }, ...sessionOf('s2') })
  eq('a second session has its own switches', other?.kind, 'deny')

  eq('and the diagnostic counts what it stopped', provided[0]?.value?.snapshot()?.blocked >= 5, true)
} else {
  check('the listener is callable', false, 'no listener was installed')
}

/* ─────────────────── 13. the installed route really answers ───────────── */

const route = routes[0]
/** A minimal ServerResponse: enough to read the status and the JSON body. */
function fakeResponse() {
  const written = { status: 0, headers: null, body: '' }
  return {
    written,
    writeHead(status, headers) {
      written.status = status
      written.headers = headers
    },
    end(chunk) {
      written.body += chunk === undefined ? '' : String(chunk)
    },
  }
}
/** A minimal IncomingMessage: the handler reads the method, the URL and the body. */
function fakeRequest(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

if (typeof route?.handler === 'function') {
  provided[0]?.value?.write('route-session', { local: true, remote: true })

  const get = fakeResponse()
  await route.handler(fakeRequest('GET', '/dsh-git-guard/state?session=route-session'), get)
  eq('GET answers 200', get.written.status, 200)
  const readBody = JSON.parse(get.written.body)
  eq('GET reports the session state', JSON.stringify(readBody.state), JSON.stringify({ local: true, remote: true }))
  eq('GET is served as JSON', get.written.headers?.['content-type'], 'application/json; charset=utf-8')

  const post = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state?session=route-session', JSON.stringify({ state: { local: false, remote: false } })), post)
  eq('POST answers 200', post.written.status, 200)
  eq('the route stores both-off as sent', JSON.stringify(JSON.parse(post.written.body).state), JSON.stringify({ local: false, remote: false }))
  eq('and that is what enforcement now reads', JSON.stringify(provided[0]?.value?.stateOf('route-session')), JSON.stringify({ local: false, remote: false }))
  const bothOffPush = await run({ name: 'bash', arguments: { command: 'git push' }, ...sessionOf('route-session') })
  eq('so a push from that session passes', bothOffPush?.kind, 'allow')
  const bothOffCommit = await run({ name: 'bash', arguments: { command: 'git commit -m x' }, ...sessionOf('route-session') })
  eq('and so does a commit', bothOffCommit?.kind, 'allow')

  /*
   * The bug this pins: the route must accept `local: false` while `remote` is
   * already `false`. Repairing it to the armed default is what made the local switch
   * impossible to turn off once the remote switch had been released.
   */
  const stillOff = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state?session=route-session', JSON.stringify({ state: { local: false, remote: false } })), stillOff)
  eq('a second local-off write is not repaired back on', JSON.stringify(JSON.parse(stillOff.written.body).state), JSON.stringify({ local: false, remote: false }))

  const independent = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state?session=route-session', JSON.stringify({ state: { local: false, remote: true } })), independent)
  eq('the route stores local-off with remote-on unchanged', JSON.stringify(JSON.parse(independent.written.body).state), JSON.stringify({ local: false, remote: true }))
  const keptPush = await run({ name: 'bash', arguments: { command: 'git push' }, ...sessionOf('route-session') })
  eq('and that state still refuses the upload', keptPush?.kind, 'deny')
  const keptCommit = await run({ name: 'bash', arguments: { command: 'git add .' }, ...sessionOf('route-session') })
  eq('while allowing the local write', keptCommit?.kind, 'allow')

  const unknown = fakeResponse()
  await route.handler(fakeRequest('GET', '/dsh-git-guard/state'), unknown)
  eq('a session-less read still answers', unknown.written.status, 200)

  const badMethod = fakeResponse()
  await route.handler(fakeRequest('DELETE', '/dsh-git-guard/state?session=x'), badMethod)
  eq('an unsupported method is refused', badMethod.written.status, 405)

  const badJson = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state?session=x', '{not json'), badJson)
  eq('malformed JSON is refused', badJson.written.status, 400)

  const tooBig = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state?session=x', JSON.stringify({ state: { pad: 'x'.repeat(20000) } })), tooBig)
  eq('an oversized body is refused', tooBig.written.status, 413)

  const fromBody = fakeResponse()
  await route.handler(fakeRequest('POST', '/dsh-git-guard/state', JSON.stringify({ session: 'body-session', state: { local: true, remote: false } })), fromBody)
  eq('a session may travel in the body', fromBody.written.status, 200)
  eq('and reaches that session', JSON.stringify(provided[0]?.value?.stateOf('body-session')), JSON.stringify({ local: true, remote: false }))
} else {
  check('the route handler is callable', false, 'no route was registered')
}

/* ──────────────── 14. the Client half is loadable and sane ────────────── */

const bundle = readFileSync(join(root, 'client.js'), 'utf8')
check('the Client half registers with the module loader', bundle.includes('window.__ModuleLoader__.load'), 'no loader call')
check('under the package id', bundle.includes("id: '@yokira404/dsh-git-guard'"), 'id mismatch')
/*
 * The seat, and why it is that one. The header's utilities list is the right-aligned
 * half of its title row, so membership of it — not a position inside the title — is
 * what puts the pair beside the window controls, and what makes it move when other
 * entries come and go. The order has to be past every entry the profile ships
 * (open-in-app -10, session log 0, the sidebar toggle 10) for the pair to stay at that
 * end; a lower one would leave it among them.
 */
check('it draws into the Session header utilities row', bundle.includes("'conversation.session.header.utilities'"), 'wrong slot')
check('and nowhere else', bundle.includes("'conversation.session.header.actions'") === false, 'the old seat is still referenced')
{
  const order = Number(/order:\s*(\d+),/.exec(bundle.slice(bundle.indexOf('function openEntry')))?.[1])
  check('the utilities order puts it after every shipped entry', Number.isFinite(order) && order > 10, 'order ' + order)
}
check('it injects only services it declares', bundle.includes("const INJECT = ['slots', 'locale']"), 'inject mismatch')
check('it talks to the Host route the Host half registers', bundle.includes("'/dsh-git-guard/state'"), 'route mismatch')
check('both switches default to on', bundle.includes('const DEFAULT_STATE = { local: true, remote: true }'), 'default mismatch')
/*
 * The rule that separates the group. It is the group's own left edge and the first
 * child of the entry, so it travels with the pair: it is drawn by the same entry in
 * the same flex row, not positioned against anything.
 */
const ruleCss = /\.dsh-gg-rule\{([^}]*)\}/.exec(bundle)?.[1] ?? ''
check('the group carries its own separator', ruleCss !== '', 'no .dsh-gg-rule rule')
if (ruleCss !== '') {
  check('the separator is a 1px vertical hairline', /width:1px/.test(ruleCss) && /height:16px/.test(ruleCss), ruleCss)
  check('and it is drawn in the host border token', /background:var\(--dsw-alias-border-l3\)/.test(ruleCss), ruleCss)
  check('and it never takes a pointer', /\.dsh-gg-rule\{/.test(bundle) && bundle.includes("'aria-hidden': 'true'"), 'the rule is not marked decorative')
  const root = /\.dsh-gg-root\{([^}]*)\}/.exec(bundle)?.[1] ?? ''
  check('the rule is a child of the group', /data-dsh-gg': 'root'/.test(bundle) && bundle.indexOf("'dsh-gg-rule'") > bundle.indexOf("'dsh-gg-root'"), 'root markup order')
  check('the group itself stacks its children in a row', /display:inline-flex/.test(root) && /align-items:center/.test(root), root)
}

/*
 * The ground carries the state, and the ground is the host's own control wash. An
 * unguarded switch has none at all — it is an icon sitting in the header — and a
 * guarded one wears the fill DSH's segmented tracks use. The icon keeps the host's
 * icon grey in *both* states; stepping it up to the primary label is what made an
 * earlier revision render near-black (`#0f1115`) among the window buttons.
 */
const HOST_BUTTON_TOKENS = [
  ['the box is the host size', /width:28px;height:28px/],
  ['the radius is the host control radius', /border-radius:var\(--dsw-radius-sm\)/],
  ['it has no border of its own', /border:none/],
  ['the off state has no ground at all', /background:0 0/],
  ['the on state wears the host control wash', /\[data-on="1"\]\{background:var\(--dsw-alias-interactive-bg-hover\)\}/],
  ['hover steps up the host ladder', /:hover\{background:var\(--dsw-alias-interactive-bg-active\)\}/],
  ['the icon is the host icon grey', /color:var\(--dsw-alias-label-secondary\)/],
  ['focus is the host focus ring', /outline:var\(--dsw-focus-ring-width\)/],
]
for (const [name, pattern] of HOST_BUTTON_TOKENS) {
  check('chrome parity: ' + name, pattern.test(bundle), String(pattern))
}
/*
 * And the icon must NOT change weight with the state: the ring, the stroke and the
 * ground already say which state a switch is in, and darkening the glyph on top of
 * that is what made the pair read as black beside the host's own buttons.
 */
{
  const css = bundle.slice(bundle.indexOf('const CSS = `'), bundle.indexOf('.dsh-gg-note'))
  check('the guarded icon is not recoloured to the primary label', css.includes('--dsw-alias-label-primary') === false, 'the guarded state still darkens the icon')
  const colours = [...new Set(css.match(/color:var\(--dsw-[a-z0-9-]+\)/g) ?? [])]
  eq('the icon has exactly one colour, in every state', JSON.stringify(colours), JSON.stringify(['color:var(--dsw-alias-label-secondary)']))
}
/*
 * The local glyph's line weight, and the two limits that keep it out of trouble.
 *
 * The cylinder is the only hand-drawn shape here, and its weight is the one property
 * a change can quietly ruin: at 2.2 the bands closed into a single dark mass at the
 * button's real size — "the lines are too thick" — while a stroke thin enough to lose
 * the bands stops reading as a stack of discs at 26px. Both limits are checked against
 * the ring and the GitHub mark rather than against fixed numbers, so the drawing can
 * still be redesigned as a whole: the subject is never heavier than the mark that
 * crosses it, and its bands always keep more air than the stroke that draws them.
 */
{
  const weight = (name) => Number(new RegExp('const ' + name + ' = \\{[^}]*strokeWidth: ([\\d.]+)').exec(bundle)?.[1])
  const body = weight('BODY_STROKE')
  const ring = weight('RING_STROKE')
  check('the body stroke width is declared', Number.isFinite(body), String(body))
  check('the ring stroke width is declared', Number.isFinite(ring), String(ring))
  check('the cylinder is no heavier than the ring around it', body <= ring, 'body ' + body + ' vs ring ' + ring)

  /*
   * Band spacing, straight off the three band paths the icon draws. Reading the *y*
   * each one starts at keeps this independent of how the curve after it is written —
   * and the curve spelling is checked separately below, because one revision wrote the
   * sweep as an elliptical arc whose radius was not half the chord, which the renderer
   * clamped into a spike: a shape that is wrong while every number here is right.
   */
  const bands = [...bundle.matchAll(/'(M9\.9 ([\d.]+)c0 1\.41[^']*)'/g)].map((match) => Number(match[2]))
  eq('the cylinder draws three bands', bands.length, 3)
  const spacing = bands.length === 3 ? bands[1] - bands[0] : 0
  check('the bands are evenly spaced', bands.length === 3 && Math.abs(bands[1] - bands[0] - (bands[2] - bands[1])) < 0.001, JSON.stringify(bands))
  check('the air between two bands exceeds the stroke that draws them', spacing - body > body, 'gap ' + (spacing - body).toFixed(2) + ' vs stroke ' + body)
}
/*
 * Every token the stylesheet names must be one the theme really defines. A renamed or
 * invented alias resolves to nothing, the declaration is dropped, and the button then
 * renders with no colour at all — which looks exactly like "the colour is wrong" and
 * is invisible in the source. The theme bundle is read from the DSH installation
 * (override with `DSH_THEME_BUNDLE`); without it the check says so and steps aside
 * rather than pretending to have verified anything.
 */
{
  const css = bundle.slice(bundle.indexOf('const CSS = `'), bundle.indexOf('.dsh-gg-note'))
  /* The match starts at `var(--`, so the token name begins six characters in. */
  const used = [...new Set((css.match(/var\((--dsw-[a-z0-9-]+)/g) ?? []).map((name) => name.slice(6)))]
  check('the stylesheet names the host tokens it needs', used.length >= 6, JSON.stringify(used))

  const candidates = [
    process.env.DSH_THEME_BUNDLE,
    'C:/Users/Yokira/AppData/Local/Temp/theme.js',
    join(workspace, '_lab', 'theme-bundle.js'),
  ].filter((path) => typeof path === 'string')
  const themePath = candidates.find((path) => existsSync(path) === true)
  if (themePath === undefined) {
    console.log('SKIP  no theme bundle was found (set DSH_THEME_BUNDLE), so token existence was not checked: ' + used.join(', '))
  } else {
    const theme = readFileSync(themePath, 'utf8')
    for (const token of used) {
      check('the theme defines ' + token, theme.includes('--' + token + ':'), 'not found in ' + themePath)
    }
  }
}
/*
 * No literal colour may appear in the button's own rules: a theme that flips must
 * carry the pair with it, which only tokens can do.
 */
{
  const rules = bundle.slice(bundle.indexOf('const CSS = `'), bundle.indexOf('.dsh-gg-note'))
  const literals = rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  eq('the button rules contain no literal colour', JSON.stringify(literals), JSON.stringify([]))
}

/*
 * The icon is the whole content of the button, and it is drawn to sit in the host's
 * row rather than to fill its box: the glyph occupies 26px of the 28px button, and the
 * drawing keeps a further margin inside its own 32-unit grid. The *page* icon
 * (`icon.svg`) is the same picture on the Plugins page's 36-unit grid, where the
 * shipped artwork does fill the box — see the check below.
 */
check('the icon fills the button box', /\.dsh-gg-icon\{display:block;width:26px;height:26px\}/.test(bundle), 'icon sizing')
/*
 * The Plugins page reads `package.json.icon` and draws it in a 48px frame at
 * `CARD_ARTWORK_SIZE` — 36px, and 30px in a row — so that file has to be a 36-unit
 * drawing rather than the header's 32-unit one. A 32-grid icon drawn at 36px would
 * still *render*, which is why this needs saying: it would simply sit smaller than
 * every neighbouring plugin's artwork, which is what "this icon is too small" was.
 */
{
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  eq('the manifest declares a page icon', manifest.icon, './icon.svg')
  const pageIcon = existsSync(join(root, 'icon.svg')) ? readFileSync(join(root, 'icon.svg'), 'utf8') : ''
  check('the page icon exists', pageIcon !== '', 'icon.svg missing')
  if (pageIcon !== '') {
    check('it is drawn on the Plugins page 36-unit grid', /viewBox="0 0 36 36"/.test(pageIcon) && /width="36"\s+height="36"/.test(pageIcon), pageIcon.slice(0, 120))
    /*
     * And it is the *header's* drawing scaled onto that grid, not a second drawing. The
     * paths are string literals in both files and can be compared as they stand; the
     * two shapes the client half keeps as objects are compared by value, since its
     * source spells them `cx: 16, cy: 10.55` while markup spells them `cx="16"`.
     */
    const scale = /translate\(18 18\) scale\(1\.125\) translate\(-16 -16\)/.test(pageIcon)
    check('the page icon is the header art scaled by 36/32 about the centre', scale, pageIcon.slice(0, 200))
    for (const [label, literal] of [
      ['cylinder outline', 'M9.9 10.55v10.9c0 1.41 2.73 2.55 6.1 2.55s6.1-1.14 6.1-2.55V10.55'],
      ['slash', 'M8.6 23.4 23.4 8.6'],
    ]) {
      check('the page icon carries the same ' + label + ' as the client half', pageIcon.includes(literal), 'missing: ' + literal)
      check('and the client half draws that same ' + label, bundle.includes(literal), label + ' not found in client.js')
    }
    const lid = /const CYLINDER_LID = \{ cx: ([\d.]+), cy: ([\d.]+), rx: ([\d.]+), ry: ([\d.]+) \}/.exec(bundle)
    check('the client half declares the lid', lid !== null, 'no CYLINDER_LID')
    check(
      'and the page icon carries the same lid',
      lid !== null && pageIcon.includes('cx="' + lid[1] + '" cy="' + lid[2] + '" rx="' + lid[3] + '" ry="' + lid[4] + '"'),
      lid === null ? 'no lid in client.js' : 'cx="' + lid[1] + '" cy="' + lid[2] + '" rx="' + lid[3] + '" ry="' + lid[4] + '"',
    )
    const ring = /const RING = \{ cx: ([\d.]+), cy: ([\d.]+), r: ([\d.]+) \}/.exec(bundle)
    check('the client half declares the ring', ring !== null, 'no RING')
    check(
      'and the page icon carries the same ring',
      ring !== null && pageIcon.includes('cx="' + ring[1] + '" cy="' + ring[2] + '" r="' + ring[3] + '"'),
      ring === null ? 'no ring in client.js' : 'cx="' + ring[1] + '" cy="' + ring[2] + '" r="' + ring[3] + '"',
    )
  }
}
/*
 * The two states differ by a mark, not by a colour: the ring and the stroke exist only
 * while the guard is on, and the state has to reach the icon for that to be true.
 */
check('the guard marks are drawn only when on', /props\.on === true \? GuardMarks\(\) : \[\]/.test(bundle), 'GuardMarks is unconditional')
check('the ring and the stroke are the state', /circle[\s\S]{0,80}key: 'ring'/.test(bundle) && /key: 'slash', d: SLASH_PATH/.test(bundle), 'ring/slash missing')
check('the local icon receives its state', /h\(LocalIcon, \{ on: state\.local === true \}\)/.test(bundle), 'local icon not told its state')
check('the remote icon receives its state', /h\(RemoteIcon, \{ on: state\.remote === true \}\)/.test(bundle), 'remote icon not told its state')
/*
 * The pair has no disabled state: every state is reachable by a click, so a button
 * that refuses clicks would only ever be a lie. The check is on the rendered
 * element's props, not on the word appearing anywhere in the file.
 */
check('the switch element never passes `disabled`', /disabled:\s*(?:true|false|props\.|state\.)/.test(bundle) === false, 'a switch still passes `disabled`')
check('normalisation in the Client repairs nothing but types', /return \{ local: source\.local !== false, remote: source\.remote !== false \}/.test(bundle), 'the Client rule drifted from the Host rule')
/*
 * The two halves are served to different runtimes, so the click rules exist twice.
 * This is the guard against one copy being edited without the other: the source text
 * of `nextState` must be byte-identical on both sides, and the Client must be the
 * only place a click is turned into state.
 */
{
  const source = readFileSync(join(root, 'index.js'), 'utf8')
  const body = (text) => {
    const start = text.indexOf('function nextState(state, clicked)')
    if (start < 0) return null
    const open = text.indexOf('{', start)
    let depth = 0
    for (let at = open; at < text.length; at += 1) {
      if (text[at] === '{') depth += 1
      else if (text[at] === '}') {
        depth -= 1
        if (depth === 0) return text.slice(open, at + 1).replace(/\s+/g, ' ')
      }
    }
    return null
  }
  const hostCopy = body(source)
  const clientCopy = body(bundle)
  check('nextState exists in both halves', hostCopy !== null && clientCopy !== null, JSON.stringify({ hostCopy: hostCopy === null, clientCopy: clientCopy === null }))
  eq('the two copies of nextState are identical', clientCopy, hostCopy)
  check('the Client turns clicks into state only through nextState', /apply\(nextState\(state, 'local'\)\)/.test(bundle) && /apply\(nextState\(state, 'remote'\)\)/.test(bundle), 'a toggle no longer goes through nextState')
}

/* ──────────────────────────── 15. packaging ───────────────────────────── */

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
eq('the manifest names the package', manifest.name, '@yokira404/dsh-git-guard')
eq('the patch id matches the Host row', /id:\s*git-guard/.test(patch), true)
check('the patch points at the manifest name', patch.includes("name: '@yokira404/dsh-git-guard'"), patch)
eq('the manifest declares the bundle patch', manifest.dsh?.bundle?.patch, './cordis.patch.yml')
eq('the Client half is a web client', manifest.dsh?.client?.platform, 'web')
eq('the manifest version matches the Host module', manifest.version, VERSION)
check('the manifest exports both halves', manifest.exports['.'] === './index.js' && manifest.exports['./client'] === './client.js', JSON.stringify(manifest.exports))
/*
 * The display text, which the Plugins page localises for itself: DSH reads
 * `locale/<lang>.json` from this package and keeps the *manifest* as the English base
 * (`dsh-app-boot`'s `readPluginMeta` → `localizedText`, whose fallback is
 * `package.json`'s own `meta`). So both halves of that contract are load-bearing:
 * a locale file that is missing a field falls back to the manifest, and a manifest
 * still written in Chinese would put Chinese text under an `en` key.
 */
for (const language of ['zh', 'en']) {
  const dictionary = JSON.parse(readFileSync(join(root, 'locale', language + '.json'), 'utf8'))
  check('locale/' + language + '.json is valid JSON with a title', typeof dictionary.meta?.title === 'string', JSON.stringify(dictionary).slice(0, 80))
  check('locale/' + language + '.json carries a description', typeof dictionary.meta?.description === 'string' && dictionary.meta.description.length > 40, JSON.stringify(dictionary.meta?.description ?? '').slice(0, 60))
}
{
  const english = JSON.parse(readFileSync(join(root, 'locale', 'en.json'), 'utf8'))
  const chinese = JSON.parse(readFileSync(join(root, 'locale', 'zh.json'), 'utf8'))
  eq('the manifest base is the English display text', manifest.meta?.title, english.meta.title)
  eq('and its description is the English one', manifest.meta?.description, english.meta.description)
  check('the two languages are actually different', chinese.meta.description !== english.meta.description, 'both locales carry the same text')
  check('the Chinese text is Chinese', /[\u4e00-\u9fff]/.test(chinese.meta.description), chinese.meta.description.slice(0, 40))
  check('the English text is not', /[\u4e00-\u9fff]/.test(english.meta.description) === false, english.meta.description.slice(0, 40))
  /*
   * Both are meant to be read at a glance on a settings page, and the first revision
   * ran to 255 characters of Chinese prose — which is what "write it more concisely"
   * was about. The two budgets differ on purpose: the same sentence costs roughly 1.8x
   * the characters in English, so one shared number would either wave Chinese through
   * or reject perfectly short English.
   */
  for (const [language, dictionary, budget] of [['zh', chinese, 220], ['en', english, 360]]) {
    check('the ' + language + ' description stays scannable', dictionary.meta.description.length <= budget, language + ': ' + dictionary.meta.description.length + ' chars, budget ' + budget)
  }
}

/* ────────────────────────────── report ────────────────────────────────── */

let failed = 0
for (const result of checks) {
  if (result.pass !== true) failed += 1
  console.log((result.pass === true ? 'PASS  ' : 'FAIL  ') + result.name + (result.pass === true ? '' : '  (' + result.detail + ')'))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
