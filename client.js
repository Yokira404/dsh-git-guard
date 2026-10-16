/**
 * Client half of @yokira404/dsh-git-guard.
 *
 * One contribution: a pair of icon switches in the Session header's right-aligned
 * utilities list (`conversation.session.header.utilities`), at the far right of that
 * row — beside the window controls, separated from whatever else the row holds by a
 * hairline rule.
 *
 * Which seat, and why: the header is a two-column grid whose second column is the
 * title row, and inside it the actions list sits beside the title while the utilities
 * list is pushed right (`margin-left:auto` on the header's own corner, `:empty` making
 * both vanish when unused). Membership of the utilities list is therefore what ties a
 * control to the window controls rather than to the title, and it is what makes the
 * group move when other entries appear or go: the list is sorted by `order` and laid
 * out in one flex row, so nothing has to be positioned by hand.
 *
 * The pair is a picture of one rule, not the rule itself. Enforcement lives in the
 * Host half, so a click here is a *request*: the new pair is normalised, drawn
 * immediately, and written to the Host's own route; the Host's answer is the
 * truth, and a request that fails puts the pair back where it was rather than
 * leaving two switches that claim to be protecting something they are not.
 *
 * The two switches are named for what they stop:
 *
 *   left  (local)   blocks `git add` / `git commit` — the local repository;
 *   right (remote)  blocks `git push` / `git remote` / `gh` — the upload.
 *
 * They are drawn as the host's own chrome buttons are — same box, same radius, same
 * tokens, no fill of their own — and the state is carried by the *icon*: an unguarded
 * repository is the repository alone, and switching a guard on adds the ring and the
 * stroke the reference uses for "forbidden".
 *
 * Shape of the pair: both start on (the protective default), all four states stay
 * reachable, nothing is ever locked, and the pair's behaviour is exactly two clicks,
 * carrying each other in opposite directions:
 *
 *   clicking the LEFT switch   toggles it; landing ON turns the RIGHT one on too,
 *                              landing OFF leaves the RIGHT one alone;
 *   clicking the RIGHT switch  toggles it; landing OFF turns the LEFT one off too,
 *                              landing ON leaves the LEFT one alone.
 *
 * So a guard is never *asked for* at the cost of the other one — only released that
 * way. `local off · remote on`, the pairing the reader asked to be able to reach from
 * both-off with a right-hand click, is reached by that click or by handling the local
 * guard back on its own; it is never reached by a right-hand click that was meant to
 * do something else.
 *
 * Both buttons are therefore always clickable, and the pair never needs a disabled
 * look to explain itself.
 */
window.__ModuleLoader__.load({
  id: '@yokira404/dsh-git-guard',
  factory(require) {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React

    /* ───────────────────────────── constants ───────────────────────────── */

    const NS = 'dsh-git-guard'
    const LOCALE_NS = 'gitGuard'
    const VERSION = '1.0.1'
    /** This package's own two routes on the Host's Web carrier, same origin as the GUI. */
    const ROUTE = '/dsh-git-guard/state'
    /** A switch is asked for, never waited on forever: the draw must never hang. */
    const REQUEST_TIMEOUT_MS = 4000
    /** Slow reconciliation, so a second window's choice reaches this one eventually. */
    const RECONCILE_MS = 20000
    /**
     * The Client's own head start, byte-identical in meaning to the Host's default.
     * Both on: the reader asked for a guard that is protecting the moment it loads.
     */
    const DEFAULT_STATE = { local: true, remote: true }

    /* ──────────────────────────── dictionaries ─────────────────────────── */

    const ZH = {
      'local.on': '本地仓库保护：开（阻止 git add / git commit 等本地写入；打开时若远端是关的，会一并打开）',
      'local.off': '本地仓库保护：关（允许本地仓库写入）',
      'local.label': '本地仓库保护',
      'remote.on': '远端仓库保护：开（阻止 git push / git remote / gh 等上传）',
      'remote.off': '远端仓库保护：关（允许上传远端仓库；关闭时本地保护会一并关闭）',
      'remote.label': '远端仓库保护',
      'failed': '未能同步到 DSH 主机，开关已还原',
    }
    const EN = {
      'local.on': 'Local repository guard: on (blocks git add / git commit and other local writes; switching it on also arms the remote guard when that one is off)',
      'local.off': 'Local repository guard: off (local repository writes allowed)',
      'local.label': 'Local repository guard',
      'remote.on': 'Remote repository guard: on (blocks git push / git remote / gh and other uploads)',
      'remote.off': 'Remote repository guard: off (uploads allowed; switching it off also releases the local guard)',
      'remote.label': 'Remote repository guard',
      'failed': 'Could not reach the DSH Host; the switches were put back',
    }

    /* ────────────────────────────── icons ─────────────────────────────── */

    /*
     * Geometry for the two states of one icon.
     *
     * The reference marks the "forbidden" reading with a ring and a stroke, and the
     * pair's own state is what the ring is *for*: an unguarded repository is drawn as
     * the repository alone, and switching the guard on adds the ring and the stroke.
     * The two states therefore differ by a whole mark rather than by a colour, which
     * is what lets these buttons drop the black/white fill and sit beside the window
     * controls looking like the host drew them.
     *
     * The art is drawn on a 32-unit grid rather than a 24 one, and that is what makes
     * it big enough to read: the whole picture is a ring around a repository, and a
     * ring around something needs more room than a bare glyph does. Everything below
     * is in those units, and the button is the host's 28px box.
     *
     * The ring encloses the art rather than sitting on top of it, which fixes both
     * sizes: at r 10.6 with a 1.5 stroke its inner edge is at 9.85, so everything
     * inside clears 9.85 while the ring's outer edge (11.35) still leaves room in the
     * 32 grid for the round cap of the slash. The drawing therefore keeps a margin
     * *inside its own grid*, which is what the host's header buttons do — the icon is
     * a glyph in the row, not a tile that fills its box.
     */
    const RING = { cx: 16, cy: 16, r: 10.6 }
    /**
     * The cylinder: a lid, a body, and three bands seen from just above the equator.
     *
     * Its *optical* centre has to be y 16 — the ring's centre and the GitHub mark's
     * centre — and the optical centre of a cylinder is the middle of its body, not the
     * middle of its bounding box: the lid above reads as a face and the base below as
     * an edge, so the eye balances them around the body. Taking the bounding box as
     * the shape put the whole glyph 1.8 units high, which is what "the left icon sits
     * a bit high" looked like. The body therefore runs y 10.55 to 21.45 (centre 16),
     * with the lid's ellipse above it and the base's below.
     *
     * Half-width 6.1 at a 1.4 stroke puts its edge at 6.8, clear of the ring's inner
     * edge at 9.85 — the gap between the cylinder and the ring is what makes the two
     * read as subject and mark rather than as one cluster.
     *
     * The bottom of the body is a cubic segment rather than an elliptical arc, and
     * deliberately so: an `a rx ry …` sweep across a half-ellipse needs the radius to
     * be *half the chord*, and the chord here is 2*sqrt(6.1² + 2.55²) = 6.61, not 6.1.
     * Writing the horizontal half-width as the radius scales the arc down past its
     * endpoints and the renderer clamps it into a spike — which is exactly what one
     * revision of this drawing looked like.
     */
    const CYLINDER_LID = { cx: 16, cy: 10.55, rx: 6.1, ry: 2.55 }
    const CYLINDER_OUTLINE = 'M9.9 10.55v10.9c0 1.41 2.73 2.55 6.1 2.55s6.1-1.14 6.1-2.55V10.55'
    const CYLINDER_BANDS = [
      'M9.9 13.2c0 1.41 2.73 2.55 6.1 2.55s6.1-1.14 6.1-2.55',
      'M9.9 16c0 1.41 2.73 2.55 6.1 2.55s6.1-1.14 6.1-2.55',
      'M9.9 18.8c0 1.41 2.73 2.55 6.1 2.55s6.1-1.14 6.1-2.55',
    ]

    /**
     * The GitHub mark. The official path is drawn for a 98 box and every unit square
     * of that box carries ink, which is what lets one transform place it without
     * measuring the outline. It is the larger of the two drawings on purpose: a solid
     * silhouette has to be bigger than a line drawing to carry the same weight, so the
     * mark's tile (18.4) exceeds the cylinder's width (12.2 plus its stroke) and the
     * ring crosses its corners the way the reference's ring crosses its subject.
     */
    const MARK_SOURCE = 98
    const MARK_TILE = 18.4
    const MARK_OFFSET = (32 - MARK_TILE) / 2
    const MARK_SCALE = MARK_TILE / MARK_SOURCE
    const MARK_PATH =
      'M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z'

    /*
     * The line weight. The reference draws its bands distinctly — each band separate,
     * with air between them — and a 2.2 stroke on this cylinder is heavy enough to
     * close those gaps into one dark mass at 26px, which is what "the lines are too
     * thick" looks like. 1.4 matches the ring's own weight, so the guarded state reads
     * as one drawing rather than a heavy subject inside a light ring, and it leaves
     * 1.4 units of clear space between bands (about 1.1px at the button's real size,
     * where the previous weight left under 0.9px and the bands merged under
     * anti-aliasing).
     */
    const BODY_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }
    const RING_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }
    const SLASH_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }
    /**
     * One diagonal across the ring, end to end, sized so both round caps land just
     * inside it rather than poking through.
     */
    const SLASH_PATH = 'M8.6 23.4 23.4 8.6'

    /**
     * The two marks a guarded icon adds. Both are drawn only while the guard is on —
     * that is the entire difference between the states, so it is the only thing these
     * two components have to decide.
     */
    function GuardMarks() {
      return [
        h('circle', { key: 'ring', cx: RING.cx, cy: RING.cy, r: RING.r, ...RING_STROKE }),
        h('path', { key: 'slash', d: SLASH_PATH, ...SLASH_STROKE }),
      ]
    }

    function IconBase(children) {
      return h(
        'svg',
        {
          viewBox: '0 0 32 32',
          width: 32,
          height: 32,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', width: '100%', height: '100%' },
        },
        children,
      )
    }

    /** The local repository: the database cylinder, ringed and struck while guarded. */
    function LocalIcon(props) {
      return IconBase([
        h('path', { key: 'body', d: CYLINDER_OUTLINE, ...BODY_STROKE }),
        h('ellipse', { key: 'lid', cx: CYLINDER_LID.cx, cy: CYLINDER_LID.cy, rx: CYLINDER_LID.rx, ry: CYLINDER_LID.ry, ...BODY_STROKE }),
        ...CYLINDER_BANDS.map((d, index) => h('path', { key: 'band' + index, d, ...BODY_STROKE })),
        ...(props !== null && props !== undefined && props.on === true ? GuardMarks() : []),
      ])
    }

    /** The remote repository: the GitHub mark, ringed and struck while guarded. */
    function RemoteIcon(props) {
      return IconBase([
        h('g', { key: 'mark', transform: 'translate(' + MARK_OFFSET + ' ' + MARK_OFFSET + ') scale(' + MARK_SCALE + ')' }, [
          h('path', { key: 'path', d: MARK_PATH, fill: 'currentColor' }),
        ]),
        ...(props !== null && props !== undefined && props.on === true ? GuardMarks() : []),
      ])
    }

    /* ───────────────────────────── stylesheet ──────────────────────────── */

    /*
     * The ground carries the state, and the ground is the host's own control wash.
     *
     * A switch that is *off* has no ground at all: an icon sitting in the header, the
     * way the chrome's bare glyph buttons sit there. A switch that is *on* wears
     * `--dsw-alias-interactive-bg-hover` — the fill DSH's segmented tracks use, which
     * the host's own stylesheet describes as "the same translucent fill the hover
     * state uses, so it reads as a place rather than a second button". So "on" reads
     * as a pressed, filled chip and "off" reads as plain chrome, which is the reading
     * a pair of guards should have.
     *
     * Hover steps one notch up the host's ladder to `--dsw-alias-interactive-bg-active`
     * — the same family, one shade stronger — so the pointer gets an answer whatever
     * the state, without a second colour being invented and without the heavy
     * `--dsw-alias-button-tool-bar-hover` (a 60% grey that is right for a toolbar at
     * the edge of a panel and far too strong for a header).
     *
     * Every token here is the host's; `evidence/selftest.mjs` asserts both that this
     * stylesheet still names them and that the theme really defines each one — an
     * alias that resolves to nothing is exactly how a button ends up with the wrong
     * colour, which is how this rule arrived at its present shape.
     *
     * The icon keeps the host's own icon grey in **both** states —
     * `--dsw-alias-label-secondary`, the `#545557` the chrome's panel toggles are drawn
     * in. An earlier revision stepped the guarded icon up to
     * `--dsw-alias-label-primary`, which the light theme resolves to `#0f1115`: a
     * near-black that made the switch look like a foreign control sitting among the
     * window buttons. The state is not told by weight at all — the ring and the stroke
     * say it, and the ground says it a second time.
     */
    const CSS = `
.dsh-gg-root{display:inline-flex;align-items:center;gap:2px}
/* The group's own left edge. It sits in the header's right-aligned utilities list,
   immediately left of the window controls, so the rule separates the guards from
   whatever else the utilities hold — and moves with them when they change. The token
   is the same hairline the header itself draws its bottom border with. */
.dsh-gg-rule{flex:none;width:1px;height:16px;margin:0 6px;background:var(--dsw-alias-border-l3)}
.dsh-gg-btn{
  position:relative;
  box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  flex:none;
  width:28px;height:28px;
  padding:0;
  border:none;
  border-radius:var(--dsw-radius-sm);
  background:0 0;
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;
  -webkit-appearance:none;appearance:none;
  transition:background-color .15s var(--ds-ease-in-out, ease), color .15s var(--ds-ease-in-out, ease);
}
/* Off is bare chrome; on adds the host's control wash. The icon stays the host's icon
   grey either way — the ring and the stroke are what say "guarded". */
.dsh-gg-btn[data-on="1"]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-gg-btn:hover{background:var(--dsw-alias-interactive-bg-active)}
.dsh-gg-btn:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-gg-btn:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  outline-offset:-2px;
}
.dsh-gg-btn:disabled{cursor:default;opacity:.45}
/* 26px of the host's 28px box: the icon is the button's whole content, so it takes
   the box in full and leaves only the 1px hairline that keeps the ring off the
   rounded edge. The box itself, its radius and its hover ground are the host's, and
   the drawing keeps the rest of its margin inside its own 32-unit grid. */
.dsh-gg-icon{display:block;width:26px;height:26px}
.dsh-gg-note{
  position:absolute;top:calc(100% + 6px);right:0;
  z-index:40;
  max-width:220px;
  padding:5px 8px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-overlay);
  color:var(--dsw-alias-label-primary);
  font-size:12px;line-height:1.35;white-space:nowrap;
  box-shadow:0 6px 18px rgba(0,0,0,.28);
  pointer-events:none;
}
`

    function insertStyles(css) {
      try {
        const builtin = typeof window === 'undefined' ? undefined : window.styles
        if (builtin !== undefined && typeof builtin.insert === 'function') return builtin.insert(css)
      } catch (error) {
        console.error('[' + NS + '] styles builtin failed', error)
      }
      const tag = document.createElement('style')
      tag.setAttribute('data-dsh-gg', 'style')
      tag.textContent = css
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /* ─────────────────────────────── state ─────────────────────────────── */

    /**
     * Coerce a value into a drawable pair. This is type repair only: the pair's two
     * behavioural rules are properties of the *gestures* that produce them and live
     * in `nextState`, never here. Putting such a rule here made it an invariant of
     * every state instead, and an invariant of that shape locks a switch on for as
     * long as its partner is off — the local switch could not be turned off again.
     */
    function normalize(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return { local: source.local !== false, remote: source.remote !== false }
    }

    /**
     * The pair's behaviour is exactly two clicks, and this is both of them. The Host
     * half carries a byte-identical copy — the two halves are served to different
     * runtimes and cannot import each other — and `evidence/selftest.mjs` asserts the
     * two spellings have not drifted apart.
     *
     * @param {{ local: boolean, remote: boolean }} state - the pair as it stands.
     * @param {'local' | 'remote'} clicked - which switch the reader pressed.
     * @returns {{ local: boolean, remote: boolean }} the pair after that click.
     */
    function nextState(state, clicked) {
      if (clicked === 'local') {
        const local = state.local !== true
        /* Landing ON turns the remote guard on too; landing OFF leaves it exactly as it was. */
        return { local, remote: local === true ? true : state.remote === true }
      }
      const remote = state.remote !== true
      /* Releasing the upload guard releases the local one with it; asking for it moves nothing. */
      return { local: remote === false ? false : state.local === true, remote }
    }

    function same(a, b) {
      return a.local === b.local && a.remote === b.remote
    }

    function stateUrl(sessionId) {
      return ROUTE + '?session=' + encodeURIComponent(sessionId === undefined || sessionId === null ? '' : String(sessionId))
    }

    /** One request that always settles: the draw must never wait on the Host. */
    async function request(url, init) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await window.fetch(url, {
          ...init,
          ...(controller === null ? {} : { signal: controller.signal }),
          credentials: 'same-origin',
        })
        if (response.ok !== true) throw new Error('HTTP ' + response.status)
        return await response.json()
      } finally {
        if (timer !== null) window.clearTimeout(timer)
      }
    }

    async function readState(sessionId) {
      const payload = await request(stateUrl(sessionId), { method: 'GET' })
      if (payload === null || payload.ok !== true) throw new Error('unexpected payload')
      return normalize(payload.state)
    }

    async function writeState(sessionId, state) {
      const payload = await request(stateUrl(sessionId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      })
      if (payload === null || payload.ok !== true) throw new Error('unexpected payload')
      return normalize(payload.state)
    }

    /* ───────────────────────────── component ───────────────────────────── */

    /**
     * One square switch. `aria-pressed` carries the state for a screen reader and
     * `data-on` carries it for the stylesheet, so neither has to be inferred from
     * the colours — which is what lets the same two colours mean two states.
     *
     * There is no disabled arm: every state this pair can be in is reachable by a
     * click, so a button that refuses clicks would only ever be a lie.
     */
    function Switch(props) {
      const { on, title, onClick, children } = props
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-gg-btn',
          'data-on': on === true ? '1' : '0',
          'data-dsh-gg': props.mark,
          title,
          'aria-label': props.ariaLabel ?? title,
          'aria-pressed': on === true ? 'true' : 'false',
          onClick,
        },
        h('span', { className: 'dsh-gg-icon' }, children),
      )
    }

    function HookBadge(props) {
      const { sessionId, t } = props
      const [state, setState] = useState(DEFAULT_STATE)
      const [failed, setFailed] = useState(false)
      const live = useRef(true)

      useEffect(() => {
        live.current = true
        return () => {
          live.current = false
        }
      }, [])

      /*
       * Read once per Session, and keep reading slowly: a second window, or this
       * one reloaded while the Host kept its own copy, has to converge on the Host
       * rather than on whichever tab drew last.
       */
      useEffect(() => {
        let cancelled = false
        const pull = async () => {
          try {
            const next = await readState(sessionId)
            if (cancelled === true || live.current === false) return
            setFailed(false)
            setState((current) => (same(current, next) === true ? current : next))
          } catch {
            /* A Host that is not answering is not a reason to draw the wrong state. */
          }
        }
        void pull()
        const timer = window.setInterval(() => void pull(), RECONCILE_MS)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [sessionId])

      /**
       * Draw the request first, then ask: a switch that waits for a round trip
       * before moving feels broken, and the Host's answer is the only thing that
       * can turn the draw back.
       */
      const apply = useCallback(
        (next) => {
          const wanted = normalize(next)
          setState(wanted)
          void (async () => {
            try {
              const confirmed = await writeState(sessionId, wanted)
              if (live.current === false) return
              setFailed(false)
              setState(confirmed)
            } catch {
              if (live.current === false) return
              setFailed(true)
              /* Put the pair back: an unconfirmed switch must not claim to guard. */
              try {
                const current = await readState(sessionId)
                if (live.current === true) setState(current)
              } catch {
                if (live.current === true) setState(DEFAULT_STATE)
              }
            }
          })()
        },
        [sessionId],
      )

      /*
       * The pair's whole behaviour is `nextState` above — two clicks, no invariants.
       * Both switches stay clickable in every state, so the reader can always reach
       * the combination they want.
       */
      const toggleLocal = useCallback(() => {
        apply(nextState(state, 'local'))
      }, [apply, state])

      const toggleRemote = useCallback(() => {
        apply(nextState(state, 'remote'))
      }, [apply, state])

      const localTitle = state.local === true ? t('local.on') : t('local.off')
      const remoteTitle = state.remote === true ? t('remote.on') : t('remote.off')

      return h(
        'div',
        { className: 'dsh-gg-root', 'data-dsh-gg': 'root', 'data-session': sessionId ?? '', 'data-version': VERSION },
        /* The rule comes first: the group's left edge, and the only thing in this
           entry that is not a switch. */
        h('span', { className: 'dsh-gg-rule', 'aria-hidden': 'true' }),
        h(
          Switch,
          {
            mark: 'local',
            on: state.local === true,
            title: localTitle,
            ariaLabel: t('local.label'),
            onClick: toggleLocal,
          },
          /*
           * The state travels into the icon: the ring and the stroke ARE the switch's
           * on state, so `on` is not decoration here, it is the whole reading.
           */
          h(LocalIcon, { on: state.local === true }),
        ),
        h(
          Switch,
          {
            mark: 'remote',
            on: state.remote === true,
            title: remoteTitle,
            ariaLabel: t('remote.label'),
            onClick: toggleRemote,
          },
          h(RemoteIcon, { on: state.remote === true }),
        ),
        failed === true ? h('div', { className: 'dsh-gg-note', role: 'status' }, t('failed')) : null,
      )
    }

    /* ─────────────────────────────── runtime ───────────────────────────── */

    const INJECT = ['slots', 'locale']

    /** Register or re-register the header action; the registry owns the disposal. */
    let disposeEntry = null
    let entryLive = false

    function openEntry(ctx) {
      disposeEntry = ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: NS,
          /*
           * The utilities list is right-aligned inside the header's title row, so
           * membership of it — not a position inside the title — is what puts the
           * pair beside the window controls. A high order keeps it at that end as
           * other entries are added: the shipped open-in-app and session-log
           * controls register at -10 and 0, the sidebar toggle at 10, and the list
           * is sorted ascending, so 100 is past them and stays past them.
           */
          order: 100,
          locale: LOCALE_NS,
          inject: () => ({}),
        },
        HookBadge,
      )
      entryLive = true
      return disposeEntry
    }

    return {
      inject: INJECT,
      apply(ctx) {
        ctx.effect(() => insertStyles(CSS), NS + ':styles')
        try {
          ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN })
        } catch (error) {
          /*
           * A dictionary is presentation: if the locale service refuses it the pair
           * still works, it just falls back to the names below. This must never be
           * the reason the plugin fails to load.
           */
          console.error('[' + NS + '] locale registration failed', error)
        }
        /*
         * The shell declares this Slot while the conversation panel boots, so the
         * injection is retried a few times: a first attempt that lands too early
         * must not cost the reader the pair for the whole session.
         */
        let attempts = 0
        const timers = new Set()
        const injectEntry = () => {
          try {
            ctx.slots.inject('conversation.session.header.utilities', () => {
              try {
                openEntry(ctx)
                return () => {
                  entryLive = false
                  if (disposeEntry !== null) disposeEntry()
                  disposeEntry = null
                }
              } catch (error) {
                console.error('[' + NS + '] register failed', error)
                throw error
              }
            })
          } catch (error) {
            attempts += 1
            console.error('[' + NS + '] inject failed (attempt ' + attempts + ')', error)
            if (attempts >= 3) return
            const timer = window.setTimeout(() => {
              timers.delete(timer)
              injectEntry()
            }, 400 * attempts)
            timers.add(timer)
          }
        }
        injectEntry()
        ctx.effect(
          () => () => {
            for (const timer of timers) window.clearTimeout(timer)
            timers.clear()
            if (entryLive === true && disposeEntry !== null) disposeEntry()
          },
          NS + ':entry',
        )
      },
    }
  },
})
