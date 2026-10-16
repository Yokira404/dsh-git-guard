/**
 * Host half of @yokira404/dsh-git-guard.
 *
 * The plugin owns two switches, drawn in the Client half beside the Session title.
 * Neither carries a colour of its own — the pair is black and white, like every
 * other control on that row — so they are named for what they stop:
 *
 *   local   blocks the repository-local half — `git add`, `git commit` and
 *           friends. Nothing leaves the machine, but it is what fills the local
 *           repository a later push would carry;
 *   remote  blocks the remote half — `git push`, `git remote`, `gh`, a repository
 *           URL on the wire.
 *
 * The pair's behaviour is exactly two clicks (both drawn by the Client, which is
 * where a click happens), and each click is a *transition*, never a standing
 * condition:
 *
 *   clicking the local switch   toggles it; when it lands ON the remote switch is
 *                               turned on too, and when it lands OFF the remote
 *                               switch is left exactly as it was;
 *   clicking the remote switch  toggles it; when it lands ON the local switch is
 *                               left exactly as it was, and when it lands OFF the
 *                               local switch is turned off too.
 *
 * Read the second rule from the *guard*, not from the switch: releasing the upload
 * guard releases the local guard with it, because the local writes are exactly what
 * an upload would carry, and a pair that let the upload through while the same bytes
 * stayed frozen on disk would be describing half a decision. Asking for the upload
 * guard is not symmetric — it relaxes nothing, so it moves nothing else, which is
 * also what leaves `local off · remote on` reachable from both-off: "let me keep
 * writing for now, and decide about pushing later" is a way of working the reader
 * asked for, not a hole. Neither rule runs in both directions: switching a guard
 * *on* never releases the other one.
 *
 * There is deliberately no "invariant" over the *stored* value — only rules about
 * the clicks that produce one. An earlier revision encoded one here as a property of
 * every state, and because it was applied on every write rather than on the click
 * that produces it, the local switch could never be turned off again while the
 * remote switch was off. A transition must be applied where the transition happens.
 * (`evidence/selftest.mjs` holds both halves of that: the full click table, all four
 * states still reachable, no click a no-op, and each click's carrying direction
 * checked in every state.)
 *
 * Enforcement lives here and nowhere else: the switch that stops a command has to
 * be the switch that owns the machine doing it, so the rule is installed on the
 * Host's own tool pipeline through `tools/pre-execute` — the documented waterfall
 * that decides allow/deny/cancel *before* a call is dispatched. The Client half is
 * presentation: it draws the two buttons and mirrors the same state back here.
 *
 * That split fixes where the state may live. A browser tab cannot veto a Host tool
 * call, so the authoritative copy is this module's own map, and the Client writes
 * through the package's own HTTP routes on `webServer` (same origin as the Web GUI,
 * no third-party service, and no code generation step). A Session the Client has
 * never reported reads as armed: the safe default is the one that blocks, because
 * the failure this plugin exists to prevent is an upload that already happened.
 *
 * The module is also its own test surface: `classifyShellCommand`, `classifyCall`
 * and `normalizeState` are pure, so `evidence/selftest.mjs` exercises the exact
 * rules the live pipeline installs rather than a paraphrase of them.
 */

export const NS = 'dsh-git-guard'
export const VERSION = '1.0.1'

/* ──────────────────────────── switch state ──────────────────────────── */

/**
 * The Client's head start for a Session this Host has not been told about. Both
 * switches start on, which is what the reference asks for and what makes the
 * plugin protective the moment it loads.
 */
export const DEFAULT_STATE = Object.freeze({ local: true, remote: true })

/**
 * Coerce anything that crossed the wire into a usable pair. Every combination of
 * the two switches is a real, storable state; this function only makes the field
 * types trustworthy, and deliberately repairs nothing else.
 *
 * The pair's behaviour lives in the two clicks below, not in the stored value.
 * Encoding either of them here as an invariant was a real bug: with the remote
 * switch already off, every later write of `local: false` was repaired back to
 * `true` on both halves, so the local switch could never be turned off again. A
 * rule that describes one transition must not be written as a property of every
 * state.
 */
export function normalizeState(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  return {
    local: asBool(source.local, DEFAULT_STATE.local),
    remote: asBool(source.remote, DEFAULT_STATE.remote),
  }
}

function asBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * The pair's behaviour is exactly two clicks, and this is both of them. The local
 * click carries the remote switch only when it lands ON; the remote click carries
 * the local switch only when it lands OFF. Neither is a property of a state, so
 * neither is applied anywhere but here — every state stays reachable and nothing is
 * ever locked.
 *
 * The Client carries a byte-identical copy (it cannot import this module), and
 * `evidence/selftest.mjs` asserts the two spellings have not drifted apart.
 *
 * @param {{ local: boolean, remote: boolean }} state - the pair as it stands.
 * @param {'local' | 'remote'} clicked - which switch the reader pressed.
 * @returns {{ local: boolean, remote: boolean }} the pair after that click.
 */
export function nextState(state, clicked) {
  if (clicked === 'local') {
    const local = state.local !== true
    /* Landing ON turns the remote guard on too; landing OFF leaves it exactly as it was. */
    return { local, remote: local === true ? true : state.remote === true }
  }
  const remote = state.remote !== true
  /* Releasing the upload guard releases the local one with it; asking for it moves nothing. */
  return { local: remote === false ? false : state.local === true, remote }
}

/* ───────────────────────── command classification ───────────────────── */

/**
 * Which half of a repository one concrete operation touches.
 *
 *   'local'  — writes the local repository object database or its refs
 *              (`git add`, `git commit`, `git reset`, `git merge`, …);
 *   'remote' — reads or writes a remote (`git push`, `git fetch`, `git remote`,
 *              `git ls-remote`, a repository URL on the wire).
 *
 * `git init`, `git status`, `git log` and `git diff` are deliberately neither:
 * creating a repository and reading it neither uploads anything nor commits to it,
 * and this plugin's own .gitignore promises the user a local repository they can
 * still inspect.
 */
export const LOCAL_SUBCOMMANDS = Object.freeze([
  'add',
  'am',
  'apply',
  'commit',
  'config',
  'merge',
  'mv',
  'notes',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'stash',
  'switch',
  'tag',
  'update-index',
  'update-ref',
  'checkout-index',
])

export const REMOTE_SUBCOMMANDS = Object.freeze([
  'archive',
  'clone',
  'fetch',
  'ls-remote',
  'pull',
  'push',
  'remote',
  'request-pull',
  'send-pack',
  'submodule',
  'svn',
])

/**
 * `gh` verbs that reach GitHub. The rest of the CLI — `gh auth`, `gh config`,
 * `gh completion`, `gh help` — is not an upload path and stays allowed, because a
 * guard that blocks a sign-in is a guard the reader turns off.
 */
const GH_REACHING = new Set([
  'alias',
  'api',
  'cache',
  'codespace',
  'extension',
  'gist',
  'issue',
  'org',
  'pr',
  'project',
  'release',
  'repo',
  'ruleset',
  'run',
  'search',
  'secret',
  'ssh-key',
  'status',
  'variable',
  'workflow',
])

/** Hosts whose traffic is somebody's remote repository. */
const GIT_HOST = /(?:^|[/.@])(?:github\.com|gitee\.com|gitlab\.com|bitbucket\.org|codeberg\.org|git\.sr\.ht|gitea\.com)(?:[/:]|$)/i
/**
 * A repository URL, wherever it is spelled: `git@github.com:x/y.git`,
 * `https://github.com/x/y.git`, `ssh://git@host/x/y`.
 *
 * A bare path is deliberately *not* a URL here. `git remote add origin /srv/git/x`
 * is a real thing, but treating any path as remote would make an ordinary
 * `mkdir -p /home/user/app` an upload, and a guard that blocks ordinary work is a
 * guard the reader turns off. A URL therefore has to carry a scheme or `git@`.
 */
const GIT_URL = /(?:git@[\w.-]+:|(?:https?|ssh|git\+ssh|git):\/\/)\S*/i
/** A command that carries bytes to a remote endpoint, rather than reading one. */
const UPLOADERS = new Set(['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm'])
/** The short `gh api` options whose value is a separate word, so it is not the endpoint. */
const API_SHORT_WITH_VALUE = new Set(['-X', '-f', '-F', '-H', '-q', '-t', '--hostname', '--method', '--raw-field', '--field', '--header', '--jq', '--template', '--input', '--cache'])

/**
 * Split a shell command into words, keeping quoted runs whole. A commit message
 * such as `git commit -m "do not push this"` must not read as a push, so the
 * tokenizer is quote-aware and the classifier only ever looks at real words.
 */
export function shellWords(text) {
  const words = []
  let current = ''
  let quote = null
  let started = false
  for (const character of String(text)) {
    if (quote !== null) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      if (started === true) words.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (started === true) words.push(current)
  return words
}

/** The program name, stripped of any directory and of a `.exe`/`.cmd` suffix. */
function programOf(word) {
  const raw = String(word).replace(/\\/g, '/')
  const bare = raw.slice(raw.lastIndexOf('/') + 1)
  return bare.replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/**
 * Read one `git` invocation and answer which half it touches.
 *
 * Global options are skipped with the arity they actually take, so `git -C /repo
 * push` and `git --git-dir=x commit` are read the same way the real CLI reads
 * them. An option is skipped with its value only when the value is a separate
 * word (`-C /repo`); `-C/repo` and `--git-dir=x` are one word already.
 */
function classifyGit(words) {
  let index = 1
  while (index < words.length && words[index].startsWith('-') === true) {
    const flag = words[index]
    const takesValueApart = flag === '-C' || flag === '-c' || flag === '--git-dir' || flag === '--work-tree' || flag === '--namespace' || flag === '--exec-path'
    index += takesValueApart === true && index + 1 < words.length ? 2 : 1
  }
  if (index >= words.length) return null
  const command = words[index].toLowerCase()
  /*
   * `git remote -v`, `git remote show origin` — any `git remote` reads or writes
   * the remote table, so the whole verb belongs to the remote half. `git config`
   * is the other way round: `remote.origin.url` is a local edit of a local file,
   * which is exactly the `local` switch's business.
   */
  if (command === 'remote') return 'remote'
  if (REMOTE_SUBCOMMANDS.includes(command) === true) return 'remote'
  if (LOCAL_SUBCOMMANDS.includes(command) === true) return 'local'
  return null
}

/** One `gh` invocation: reaching a repository, or an upload, or neither. */
function classifyGh(words) {
  let index = 1
  while (index < words.length && words[index].startsWith('-') === true) index += 1
  if (index >= words.length) return null
  const verb = words[index].toLowerCase()
  /*
   * `gh --version` and `gh help` are answered by the CLI itself and never resolve
   * a repository, so they are not upload paths.
   */
  if (verb === 'help' || verb === '--version' || verb === '-v') return null
  if (GH_REACHING.has(verb) === false) return null
  /*
   * `gh api -X GET /user` is a read of the account, not of a repository: only an
   * endpoint that names one counts. Everything else under a reaching verb does.
   * The lookbehind matters — `/repos` is a repository endpoint and `/user/repos`
   * is the current account's repository collection, so both count, while
   * `/users/octocat` on its own does not.
   */
  if (verb === 'api') {
    /*
     * `gh api` spells its arguments as `-X POST /repos/x/y/git/refs`, so the
     * endpoint is the first positional word — which means the flags in front of it
     * have to be walked with the arity they really take, or `POST` reads as the
     * endpoint and `/repos/…` is never seen.
     */
    let cursor = index + 1
    while (cursor < words.length) {
      const word = words[cursor]
      if (word === '--') {
        cursor += 1
        break
      }
      if (word.startsWith('-') === false) break
      const inline = word.includes('=')
      cursor += inline === true || API_SHORT_WITH_VALUE.has(word) === false ? 1 : 2
    }
    if (cursor >= words.length) return null
    return /(?:\/repos\b|\/orgs\/|\/gists\b|\/user\/repos\b)/i.test(words[cursor]) === true ? 'remote' : null
  }
  return 'remote'
}

/**
 * Classify one shell command line. Chained commands are classified segment by
 * segment and the *strongest* finding wins, so `git add -A && git push` is a
 * remote operation while `git status && git log` is nothing at all.
 *
 * Returns 'remote' | 'local' | null.
 */
export function classifyShellCommand(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const words = shellWords(text)
  if (words.length === 0) return null

  /*
   * Every word is a candidate program name, because a real invocation can be
   * prefixed: `sudo git push`, `env FOO=1 git commit`, `nohup git fetch`. A word
   * is only read as `git`/`gh` when it *is* that program, which is what makes the
   * scan safe to run over the whole line.
   *
   * The strongest finding wins. `git remote add origin <url>` is remote because
   * its verb says so; `git config remote.origin.url <url>` is local because *its*
   * verb says so, even though a repository URL is spelled on the line — a config
   * write is a local write, and calling it an upload would block it under the
   * wrong switch.
   */
  let best = null
  let urlSeen = false
  for (let index = 0; index < words.length; index += 1) {
    const program = programOf(words[index])
    if (program === 'git') {
      const found = classifyGit(words.slice(index))
      if (found === 'remote') return 'remote'
      if (found === 'local') best = 'local'
    } else if (program === 'gh') {
      const found = classifyGh(words.slice(index))
      if (found === 'remote') return 'remote'
      if (found === 'local') best = 'local'
    } else if (UPLOADERS.has(program) === true) {
      /*
       * A fetcher is only an upload when the wire is somebody's repository, and
       * that is precisely what the URL check below reads. Asking again here keeps
       * `curl https://example.com` an ordinary download.
       */
      if (GIT_HOST.test(text) === true) urlSeen = true
    }
  }
  if (GIT_URL.test(text) === true && GIT_HOST.test(text) === true) urlSeen = true
  /*
   * A repository URL with no verb to explain it is somebody reaching a repository
   * host directly, so it reports 'remote' and never 'local': a URL does not write
   * a local repository object. A URL that *is* explained by a verb has already
   * been answered above, which is why this is the last word rather than the first.
   */
  if (best !== null) return best
  return urlSeen === true ? 'remote' : null
}

/* ──────────────────────────── call classification ───────────────────── */

/**
 * Every field of a tool call that can carry a command line, most specific first.
 * A call is only ever as dangerous as its most dangerous field, so all of them
 * are read rather than the first one found.
 */
const COMMAND_FIELDS = Object.freeze(['command', 'script', 'cmd', 'code', 'input', 'content'])

function collectText(value, out, depth) {
  if (depth > 4 || out.length > 64) return
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value) === true) {
    for (const item of value) collectText(item, out, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) collectText(value[key], out, depth + 1)
  }
}

/** The command-like strings one tool call carries, deduplicated. */
export function commandTexts(args) {
  const out = []
  if (args === null || typeof args !== 'object') return out
  for (const field of COMMAND_FIELDS) {
    if (field in args === false) continue
    collectText(args[field], out, 0)
  }
  const seen = new Set()
  return out.filter((text) => (seen.has(text) === true ? false : (seen.add(text), true)))
}

/** How a call reads once classified: which verb, which half, and why. */
export function classifyCall(args) {
  let best = null
  let evidence = null
  for (const text of commandTexts(args)) {
    const operation = classifyShellCommand(text)
    if (operation === 'remote') return { operation: 'remote', evidence: text }
    if (operation === 'local' && best === null) {
      best = 'local'
      evidence = text
    }
  }
  return best === null ? null : { operation: best, evidence }
}

/**
 * The whole rule, in one place: does this pending call survive the two switches?
 *
 * Each switch answers for its own half and nothing else, which is what makes the
 * pair independent: `local` off means local writes pass even while `remote` still
 * blocks uploads, and a state that survived `normalizeState` can never be the other
 * way round.
 */
export function decide(state, { operation }) {
  if (state.remote === true && operation === 'remote') return 'remote'
  if (state.local === true && operation === 'local') return 'local'
  return null
}

/**
 * The denial the model receives. It names the switch by its position in the
 * Session header rather than by a colour, because the pair has none: the reader
 * finds it by looking at the same two squares the message points at.
 */
export function denialMessage(switchName, evidence) {
  const command = evidence === null || evidence === undefined ? '' : '`' + String(evidence).slice(0, 300) + '`'
  const where = switchName === 'remote' ? '右侧的远端仓库开关' : '左侧的本地仓库开关'
  const what =
    switchName === 'remote'
      ? '上传远端仓库的操作（git push / git remote / gh 等）'
      : '写入本地仓库的操作（git add / git commit 等）'
  return (
    '已阻止：DSH 的「Git 仓库保护」插件当前开着' +
    where +
    '，' +
    what +
    '被拒绝。\n' +
    (command === '' ? '' : '被拦截的命令：' + command + '\n') +
    '这是用户有意设置的开关，不是故障：不要改用其他命令、其他工具或直接调用 API 绕过它，' +
    '也不要尝试关闭该开关。请把这一步作为「未执行」如实报告给用户，并说明用户可以点击会话标题栏的两个方形按钮自行放行。'
  )
}

/* ─────────────────────────────── host ───────────────────────────────── */

/**
 * Install the rule and the Client's read/write route.
 *
 * Nothing here is awaited: the activation must not depend on a Client being
 * connected, because the switch that protects a headless Session is exactly the
 * one whose Client is not there to confirm it.
 */
export function apply(ctx) {
  const states = new Map()
  const known = new Set()
  let blocked = 0
  let lastBlock = null

  const stateOf = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return DEFAULT_STATE
    const held = states.get(sessionId)
    if (held !== undefined) return held
    /*
     * A Session the Client has never reported is armed. Writing the default into
     * the map is what makes the answer stable and cheap; the first write from the
     * Client replaces it.
     */
    states.set(sessionId, { ...DEFAULT_STATE })
    return states.get(sessionId)
  }

  const write = (sessionId, value) => {
    const next = normalizeState(value)
    if (typeof sessionId === 'string' && sessionId !== '') {
      states.set(sessionId, next)
      known.add(sessionId)
    }
    return next
  }

  /* 1. the rule itself, on the documented pre-dispatch waterfall */
  ctx.on('tools/pre-execute', async (exec, next) => {
    const state = stateOf(exec !== null && exec !== undefined && exec.agent !== undefined && exec.agent !== null ? exec.agent.id : undefined)
    if (state.local === false && state.remote === false) return next()
    const finding = classifyCall(exec !== null && exec !== undefined ? exec.arguments : undefined)
    if (finding === null) return next()
    const switchName = decide(state, finding)
    if (switchName === null) return next()
    blocked += 1
    lastBlock = { switch: switchName, tool: String(exec.name), at: Date.now() }
    return {
      kind: 'deny',
      reason: denialMessage(switchName, finding.evidence),
      info: { name: 'GitGuardBlocked', code: 'DSH_GIT_GUARD_BLOCKED', reason: switchName },
    }
  })

  /* 2. the Client's own two routes, on the Web composition's HTTP carrier */
  ctx.inject(['webServer'], (scope) => {
    const json = (res, status, body) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
      })
      res.end(payload)
    }
    const sessionOf = (url) => {
      const value = url.searchParams.get('session')
      return value === null ? '' : value
    }
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: '/dsh-git-guard/state',
          handler: async (req, res) => {
            if (req.method === 'GET') {
              const session = sessionOf(new URL(req.url ?? '/', 'http://127.0.0.1'))
              return json(res, 200, { ok: true, state: stateOf(session), version: VERSION, stats: { blocked, lastBlock } })
            }
            if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
            let body = ''
            for await (const chunk of req) {
              body += chunk
              /* A Client that streams an unbounded body is not a Client of ours. */
              if (body.length > 16384) {
                return json(res, 413, { ok: false, error: 'payload-too-large' })
              }
            }
            let parsed = null
            try {
              parsed = JSON.parse(body === '' ? '{}' : body)
            } catch {
              return json(res, 400, { ok: false, error: 'invalid-json' })
            }
            const fromQuery = sessionOf(new URL(req.url ?? '/', 'http://127.0.0.1'))
            const session = fromQuery !== '' ? fromQuery : String(parsed?.session ?? '')
            const next = write(session, parsed?.state)
            return json(res, 200, { ok: true, state: next, version: VERSION })
          },
        }),
      NS + ':route',
    )
  })

  /*
   * Diagnostics for the plugin's own verification and for anyone reading the
   * process: reading it does not change state, and the map is exposed as a plain
   * object so a probe never holds a live reference into the guard.
   */
  ctx.provide(NS, {
    version: VERSION,
    stateOf: (sessionId) => ({ ...stateOf(sessionId) }),
    write,
    snapshot: () => ({ blocked, lastBlock, sessions: Object.fromEntries([...states].map(([id, value]) => [id, { ...value }])), known: [...known] }),
    classify: (args) => classifyCall(args),
    decide: (state, finding) => decide(normalizeState(state), finding),
  })
}
