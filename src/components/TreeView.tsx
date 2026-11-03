import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import 'd3-transition'
import type { WordId } from '../types'
import { byId, childrenOf, isAlive, lineage } from '../data'
import { wordFor } from '../data/words'
import { AXIS_TICKS, MAX_YEAR, clampYear, formatYearShort, fractionToYear } from '../lib/time'
import { HEADER_H, PAD_L, PAD_R, buildLayout, familySections, makeX, sectionOf, type Layout } from '../lib/layout'

type Props = {
  year: number
  word: WordId | null
  selectedId: string | null
  focusSeq: number
  onSelect: (id: string | null) => void
  onYear: (y: number) => void
}

const AXIS_H = 32
/** Phones lay history out over this many pixels, about three screens. */
const PHONE_TRACK = 1150
const PANEL_W = 412

function descendants(id: string, out = new Set<string>()): Set<string> {
  for (const k of childrenOf.get(id) ?? []) {
    out.add(k.id)
    descendants(k.id, out)
  }
  return out
}

/**
 * Pan and zoom work like the first version of Babel, which behaved well on
 * phones: d3-zoom owns every gesture. One finger (or a mouse drag) pans in any
 * direction, two fingers pinch, a plain wheel or trackpad scrolls, ctrl/⌘ +
 * wheel zooms. The drawing is one transformed group, so a gesture only changes
 * a single attribute.
 */
export function TreeView({ year, word, selectedId, focusSeq, onSelect, onYear }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null)
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const tRef = useRef(t)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [size, setSize] = useState(() => ({
    w: typeof window === 'undefined' ? 1200 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  const pendingFocus = useRef(false)

  const layout = useMemo(() => buildLayout(collapsed), [collapsed])
  const isPhone = size.w < 760
  // Desktop: all of history fits the screen at 100 %. Phone: readable at 100 %.
  const track = isPhone ? PHONE_TRACK : Math.max(700, size.w - PAD_L - PAD_R - 8)
  const x = useMemo(() => makeX(track), [track])
  const chartW = PAD_L + track + PAD_R
  const fitK = Math.min(1, size.w / chartW)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Set up gestures once.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const z = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((e: Event) => {
        if (e.type === 'wheel') return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey
        if (e.type === 'dblclick') return false
        return !(e as MouseEvent).button
      })
      .constrain((tr) => constrainRef.current(tr))
      .on('start', (e) => {
        if (e.sourceEvent) {
          // A touch that stops a glide only stops it: it must not also select
          // whatever language happens to be under the finger.
          if (raf) suppressClickUntil = performance.now() + 450
          stopGlide()
          samples.length = 0
        }
      })
      .on('zoom', (e) => {
        tRef.current = e.transform
        // Redraw once per frame, and everything together: the drawing, date
        // bar, family headers and names move in the same frame, so nothing
        // lags behind anything else.
        if (!renderQueued) {
          renderQueued = true
          requestAnimationFrame(() => {
            renderQueued = false
            flushSync(() => setT(tRef.current))
          })
        }
        const src = e.sourceEvent as Event | null
        if (src && src.type === 'touchmove') {
          if ((src as TouchEvent).touches.length === 1) {
            const now = performance.now()
            samples.push({ x: e.transform.x, y: e.transform.y, t: now })
            while (samples.length > 2 && now - samples[0].t > 100) samples.shift()
          } else samples.length = 0
        }
      })
      .on('end', (e) => {
        const src = e.sourceEvent as Event | null
        if (src && src.type === 'touchend') glide()
      })
    zoomRef.current = z
    const sel = select(el)
    sel.call(z)
    // No double-tap zoom: quick taps (say, to stop a glide) must not zoom.
    sel.on('dblclick.zoom', null)

    // Momentum, tuned like iOS scrolling: the tree keeps the flick's speed and
    // slows smoothly (about half a second to lose two thirds of it). It stops
    // at the edges and the moment a finger touches down again.
    let renderQueued = false
    let suppressClickUntil = 0
    const samples: { x: number; y: number; t: number }[] = []
    let raf = 0
    function stopGlide() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    function glide() {
      const now = performance.now()
      const last = samples[samples.length - 1]
      // Velocity over the last ~100 ms of movement, not the whole drag.
      const first = samples.find((p) => last && last.t - p.t <= 100) ?? samples[0]
      samples.length = 0
      if (!last || !first || last === first) return
      // The finger was held still before lifting: no flick.
      if (now - last.t > 60) return
      const dt = last.t - first.t
      if (dt < 8) return
      let vx = (last.x - first.x) / dt
      let vy = (last.y - first.y) / dt
      const speed = Math.hypot(vx, vy)
      if (speed < 0.12) return
      const cap = 7
      if (speed > cap) {
        vx *= cap / speed
        vy *= cap / speed
      }
      let prev = performance.now()
      const step = (t: number) => {
        const ms = Math.min(34, Math.max(1, t - prev))
        prev = t
        const before = tRef.current
        z.translateBy(sel, (vx * ms) / before.k, (vy * ms) / before.k)
        const after = tRef.current
        // Reached an edge on one axis: stop moving along it.
        if (Math.abs(after.x - before.x) < 0.01) vx = 0
        if (Math.abs(after.y - before.y) < 0.01) vy = 0
        const decay = Math.pow(0.998, ms)
        vx *= decay
        vy *= decay
        raf = Math.hypot(vx, vy) > 0.03 ? requestAnimationFrame(step) : 0
      }
      raf = requestAnimationFrame(step)
    }
    const swallowClick = (e: Event) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation()
        e.preventDefault()
        suppressClickUntil = 0
      }
    }
    el.addEventListener('click', swallowClick, true)

    // A plain wheel or two-finger trackpad swipe pans, like scrolling a page.
    sel.on(
      'wheel.pan',
      (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) return
        e.preventDefault()
        z.translateBy(sel, -e.deltaX / tRef.current.k, -e.deltaY / tRef.current.k)
      },
      { passive: false },
    )
    return () => {
      stopGlide()
      el.removeEventListener('click', swallowClick, true)
      sel.on('.zoom', null).on('wheel.pan', null)
    }
  }, [])

  // Keep the tree on screen. Limits are in screen pixels, so they hold at any
  // zoom: the first family always clears the date bar, 4500 BC never slides
  // past the left edge, and "today" never past the right (on desktop, with
  // room to move it out from under the detail panel).
  const constrainRef = useRef((tr: ZoomTransform) => tr)
  constrainRef.current = (tr: ZoomTransform) => {
    const el = rootRef.current
    if (!el) return tr
    const vw = el.clientWidth
    const vh = el.clientHeight
    const extra = selectedId && !isPhone ? PANEL_W : 0
    const w = chartW * tr.k
    const h = layout.height * tr.k
    const left = 8
    const right = vw - extra - 8
    const top = AXIS_H + 6
    const bottom = vh - 70
    const tx = w <= right - left ? left + (right - left - w) / 2 : Math.min(left, Math.max(right - w, tr.x))
    const ty = h <= bottom - top ? top : Math.min(top, Math.max(bottom - h, tr.y))
    return tx === tr.x && ty === tr.y ? tr : zoomIdentity.translate(tx, ty).scale(tr.k)
  }

  useEffect(() => {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z) return
    z.scaleExtent([Math.min(0.3, fitK * 0.95), 4])
    select(el).call(z.translateBy, 0, 0)
  }, [chartW, fitK, layout.height, selectedId, isPhone])

  // Open with the chosen year in view.
  const opened = useRef(false)
  useEffect(() => {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z || opened.current || el.clientWidth === 0) return
    opened.current = true
    const vw = el.clientWidth
    const minTx = vw - (chartW + 10)
    const tx = Math.max(Math.min(0, minTx), Math.min(0, vw * 0.5 - x(year)))
    select(el).call(z.transform, zoomIdentity.translate(tx, AXIS_H))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w])

  // Keep the year line on screen while scrubbing or playing.
  useEffect(() => {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z) return
    const vw = el.clientWidth - (selectedId && !isPhone ? PANEL_W : 0)
    const sx = tRef.current.applyX(x(year))
    const m = Math.min(80, vw * 0.12)
    if (sx < m) z.translateBy(select(el), (m - sx) / tRef.current.k, 0)
    else if (sx > vw - m) z.translateBy(select(el), (vw - m - sx) / tRef.current.k, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  // Bring the selected language into view, unfolding its family if needed.
  useEffect(() => {
    if (!focusSeq || !selectedId) return
    const sec = sectionOf(selectedId)
    if (collapsed.has(sec)) {
      const next = new Set(collapsed)
      next.delete(sec)
      setCollapsed(next)
    }
    pendingFocus.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq, selectedId])

  useEffect(() => {
    const el = rootRef.current
    const z = zoomRef.current
    if (!pendingFocus.current || !el || !z || !selectedId) return
    const row = layout.rowById.get(selectedId)
    if (!row) return
    pendingFocus.current = false
    const k = Math.max(tRef.current.k, 0.85)
    const tx = (isPhone ? 24 : 120) - x(row.lang.start) * k
    const ty = (isPhone ? el.clientHeight * 0.18 : el.clientHeight * 0.38) - row.y * k
    select(el).transition().duration(550).call(z.transform, zoomIdentity.translate(tx, ty).scale(k))
  }, [layout, selectedId, focusSeq, x, isPhone])

  const related = useMemo(() => {
    if (!selectedId) return null
    const s = new Set(lineage(selectedId).map((l) => l.id))
    for (const d of descendants(selectedId)) s.add(d)
    return s
  }, [selectedId])

  function toggle(id: string) {
    const next = new Set(collapsed)
    // Folding a whole family (Indo-European) folds all its branches with it.
    const ids = familySections(id).length > 1 ? familySections(id) : [id]
    if (next.has(id)) for (const s of ids) next.delete(s)
    else for (const s of ids) next.add(s)
    setCollapsed(next)
  }

  const allFolded = collapsed.size === layout.sections.length
  function toggleAll() {
    setCollapsed(allFolded ? new Set() : new Set(layout.sections.map((s) => s.group.id)))
  }

  function zoomBy(f: number) {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z) return
    select(el).transition().duration(250).call(z.scaleBy, f, [el.clientWidth / 2, el.clientHeight / 2])
  }

  function fit() {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z) return
    // Whole width of history on screen, keeping the rows that are in view.
    const top = tRef.current.invertY(AXIS_H + 6)
    select(el)
      .transition()
      .duration(350)
      .call(z.transform, zoomIdentity.translate(0, AXIS_H + 6 - top * fitK).scale(fitK * 0.97))
  }

  function axisYear(clientX: number): number {
    const el = rootRef.current!
    const px = tRef.current.invertX(clientX - el.getBoundingClientRect().left)
    return clampYear(fractionToYear((px - PAD_L) / track))
  }

  const yearX = x(year)
  // Snap the view to whole screen pixels, so text never shimmers between
  // pixels as it moves.
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const snap = (v: number) => Math.round(v * dpr) / dpr
  const view = zoomIdentity.translate(snap(t.x), snap(t.y)).scale(t.k)
  // Axis ticks in screen space. Labels near an edge are nudged inwards rather
  // than cut off, and any label that would then crowd its neighbour is dropped.
  const ticks = useMemo(() => {
    const out: { tick: number; sx: number; lx: number; label: string }[] = []
    const todayX = view.applyX(x(MAX_YEAR))
    let last = -Infinity
    for (const tick of AXIS_TICKS) {
      const sx = view.applyX(x(tick))
      if (sx < -30 || sx > size.w + 30) continue
      const label = formatYearShort(tick)
      const half = label.length * 3.4
      const lx = Math.min(Math.max(sx, half + 4), size.w - half - 4)
      if (lx - last < 58 || todayX - lx < 52) continue
      out.push({ tick, sx, lx, label })
      last = lx
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.x, view.k, x, size.w])

  const edge = view.invertX(10)
  const viewTop = t.invertY(0)
  const viewBottom = t.invertY(size.h)

  return (
    <div ref={rootRef} className="tree" onClick={() => onSelect(null)}>
      <svg className="tree__svg" width="100%" height="100%" role="img" aria-label="Time-scaled family tree of languages">
        <g ref={gRef} transform={view.toString()}>
          <Grid x={x} height={layout.height} />
          <Branches layout={layout} x={x} year={year} selectedId={selectedId} related={related} />
          <line className="tree__year" x1={yearX} x2={yearX} y1={-4000} y2={layout.height + 4000} />
          <Labels
            layout={layout}
            x={x}
            year={year}
            word={word}
            selectedId={selectedId}
            related={related}
            edge={edge}
            onSelect={onSelect}
          />
        </g>
      </svg>

      <div className="tree__heads">
        {layout.sections
          .filter((s) => s.y0 + HEADER_H > viewTop - 40 && s.y0 < viewBottom + 40)
          .map((s) => (
            <div
              key={s.group.id}
              className={`section__head${s.isBranch ? ' is-branch' : ''}`}
              style={{
                // Branch headers sit just right of the family trunk while it is
                // on screen, and stick to the left edge once it scrolls away.
                transform: `translate(${s.isBranch ? snap(Math.max(0, view.applyX(PAD_L) - 4 * t.k)) : 0}px, ${snap(view.applyY(s.y0))}px) scale(${t.k})`,
              }}
            >
              <button
                type="button"
                className={`section__btn${s.collapsed ? ' is-collapsed' : ''}`}
                aria-expanded={!s.collapsed}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(s.group.id)
                }}
              >
                <span className="section__chev" aria-hidden="true">
                  ▾
                </span>
                <span className="dot" style={{ background: s.group.color }} />
                <span className="section__label">{s.group.label}</span>
                {!s.isBranch && s.familyCount > s.count && <span className="section__kind">family</span>}
                <span className="section__count" title={`${s.familyCount} languages`}>
                  {s.isBranch ? s.count : s.familyCount}
                </span>
              </button>
              {s.from && (
                <button
                  type="button"
                  className="section__from"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(s.from!.id)
                  }}
                >
                  from {s.from.name}
                </button>
              )}
            </div>
          ))}
      </div>

      <svg
        className="tree__axis"
        width="100%"
        height={AXIS_H}
        role="slider"
        aria-label="Year on the tree: tap to set"
        aria-valuenow={year}
        onClick={(e) => {
          e.stopPropagation()
          onYear(axisYear(e.clientX))
        }}
      >
        <rect className="axis__bg" width="100%" height={AXIS_H} />
        {ticks.map(({ tick, sx, lx, label }) => (
          <g key={tick} transform={`translate(${sx},0)`} className="axis__tick">
            <line y1={AXIS_H - 7} y2={AXIS_H} />
            <text x={lx - sx} y={AXIS_H - 13}>
              {label}
            </text>
          </g>
        ))}
        {(() => {
          const sx = view.applyX(x(MAX_YEAR))
          if (sx < -30 || sx > size.w + 30) return null
          const lx = Math.min(Math.max(sx, 22), size.w - 22)
          return (
            <g transform={`translate(${sx},0)`} className="axis__tick">
              <text x={lx - sx} y={AXIS_H - 13}>
                Today
              </text>
            </g>
          )
        })()}
        <g transform={`translate(${view.applyX(yearX)},0)`} className="axis__now">
          <path d={`M-6,${AXIS_H - 9}L6,${AXIS_H - 9}L0,${AXIS_H}z`} />
        </g>
      </svg>

      <div className={`tree__tools${selectedId ? ' is-shifted' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={toggleAll}>
          {allFolded ? 'Unfold all' : 'Fold all'}
        </button>
        <span className="tree__tools-sep" />
        <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button type="button" onClick={fit} title="Fit all of history">
          Fit
        </button>
        <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
      </div>
    </div>
  )
}

const Grid = memo(function Grid({ x, height }: { x: (y: number) => number; height: number }) {
  return (
    <g className="grid">
      {AXIS_TICKS.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={height} />
      ))}
    </g>
  )
})

type BranchProps = {
  layout: Layout
  x: (y: number) => number
  year: number
  selectedId: string | null
  related: Set<string> | null
}

/** Branch thickness grows with how much of the tree hangs from it. */
const SPREAD = new Map<string, number>()
function spread(id: string): number {
  const hit = SPREAD.get(id)
  if (hit != null) return hit
  let n = 0
  for (const k of childrenOf.get(id) ?? []) n += 1 + spread(k.id)
  SPREAD.set(id, n)
  return n
}
function thickness(id: string): number {
  return Math.min(11, 3 + 1.5 * Math.log2(1 + spread(id)))
}

/** Width of a limb at drawing-x `at`, tapering from base to tip. */
function widthAt(l: { id: string; start: number; end: number | null }, at: number, x: (y: number) => number): number {
  const w0 = thickness(l.id)
  const w1 = tipWidth(l)
  const x0 = x(l.start)
  const x1 = Math.max(x0 + 2, x(l.end ?? MAX_YEAR))
  const f = Math.min(1, Math.max(0, (at - x0) / (x1 - x0)))
  return w0 + (w1 - w0) * f
}
function tipWidth(l: { id: string; end: number | null }): number {
  const w0 = thickness(l.id)
  return l.end == null ? Math.max(2.2, w0 * 0.55) : Math.max(1.6, w0 * 0.35)
}

/** Darken a #rrggbb colour by mixing it towards black. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(v * (1 - amount))
    .toString(16)
    .padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

type P = [number, number]
/**
 * A branch that leaves its parent and sweeps into the daughter's base, drawn
 * as a filled ribbon that narrows from `w0` to `w1`: the cubic curve is
 * sampled and each point is pushed out along the curve's normal.
 */
function ribbon(p0: P, p1: P, p2: P, p3: P, w0: number, w1: number): string {
  const N = 16
  const top: P[] = []
  const bot: P[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const u = 1 - t
    const px = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
    const py = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0])
    const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1])
    const len = Math.hypot(dx, dy) || 1
    // Ease the width so the branch swells a little where it leaves the bough.
    const h = (w0 + (w1 - w0) * (t * t * (3 - 2 * t))) / 2
    const nx = (-dy / len) * h
    const ny = (dx / len) * h
    top.push([px + nx, py + ny])
    bot.push([px - nx, py - ny])
  }
  const f = (q: P) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`
  return `M${top.map(f).join('L')}L${bot.reverse().map(f).join('L')}Z`
}

/**
 * A family's trunk: the root language (Proto-Indo-European) grows down the
 * left of the chart, and each branch (Germanic, Celtic, …) sweeps out of it to
 * where that branch begins. The trunk thins as branches leave it.
 */
function FamilyTrunks({ layout, x, related }: { layout: Layout; x: (y: number) => number; related: Set<string> | null }) {
  const byTrunk = new Map<string, typeof layout.offshoots>()
  for (const o of layout.offshoots) {
    if (!o.child) continue
    const list = byTrunk.get(o.trunk.lang.id) ?? []
    list.push(o)
    byTrunk.set(o.trunk.lang.id, list)
  }
  return (
    <g className="trunks">
      {[...byTrunk.values()].map((list) => {
        const trunk = list[0].trunk
        const tx = x(trunk.lang.start)
        const y0 = trunk.y
        const last = list[list.length - 1]
        const wTop = thickness(trunk.lang.id) * 0.95
        const wBottom = Math.max(2.4, thickness(last.child!.lang.id) * 0.9)
        const color = trunk.group.color
        const dimTrunk = related ? !related.has(trunk.lang.id) : false
        // Down the left, ending in a curve into the last branch.
        const yEnd = last.y - 24
        const trunkPath = ribbon([tx, y0], [tx, y0 + (yEnd - y0) * 0.33], [tx, y0 + (yEnd - y0) * 0.66], [tx, yEnd], wTop, wBottom)
        return (
          <g key={trunk.lang.id}>
            <path className={`trunk${dimTrunk ? ' is-dim' : ''}`} d={trunkPath} fill={shade(color, 0.3)} />
            {list.map((o) => {
              const child = o.child!
              const xr = x(o.start)
              const yb = o.y
              // Leave the trunk a little above the branch and sweep right into it.
              const ys = Math.max(y0 + 8, yb - Math.min(60, Math.max(26, (xr - tx) * 0.35)))
              const wc = thickness(child.lang.id)
              // Trunk width where this branch leaves it.
              const f = Math.min(1, Math.max(0, (ys - y0) / Math.max(1, yEnd - y0)))
              const ws = Math.min(wTop + (wBottom - wTop) * f, wc * 1.1)
              const k = Math.max(10, (xr - tx) * 0.5)
              const d = ribbon([tx, ys], [tx, ys + (yb - ys) * 0.75], [xr - k, yb], [xr, yb], Math.max(1.6, ws * 0.9), wc)
              const dim = related ? !(related.has(child.lang.id) && related.has(trunk.lang.id)) : false
              return <path key={o.sectionId} className={`trunk__branch${dim ? ' is-dim' : ''}`} d={d} fill={shade(child.group.color, 0.18)} />
            })}
          </g>
        )
      })}
    </g>
  )
}

/** A leaf pointing right from its stem, about 16 units long. */
const LEAF = 'M0,0C2.5,-5.8 9.5,-8.4 16,-6.2C13.2,-0.8 7,2.6 0,0Z'
const LEAF_LIGHT = 'M0,0C2.5,-5.8 9.5,-8.4 16,-6.2C10.5,-4.2 5,-2.2 0,0Z'
/** Fans of leaf angles: one, two or three leaves. */
const FANS = [[-24], [-40, 6], [-50, -14, 20]]

function leafCount(speakers?: number): number {
  if (speakers == null) return 1
  if (speakers >= 100) return 3
  if (speakers >= 10) return 2
  return 1
}

function Leaves({ x, y, n, scale }: { x: number; y: number; n: number; scale: number }) {
  return (
    <g className="bar__leaf" transform={`translate(${x},${y})`}>
      {FANS[n - 1].map((deg, i) => (
        <g key={i} transform={`rotate(${deg}) scale(${scale * (i === 1 && n === 3 ? 1.08 : 0.94)})`}>
          <path d={LEAF} />
          <path className="bar__leaf-light" d={LEAF_LIGHT} />
          <path className="bar__vein" d="M1.5,-0.4C6,-2.6 10,-4.2 14,-5.6" />
        </g>
      ))}
    </g>
  )
}

/**
 * Branches, twigs and leaves: everything that does not move on scroll.
 * Each language is a limb that tapers from a dark base to a lighter tip.
 * Daughters sweep off their parent's limb as smooth tapered branches, the
 * same width as the limb they feed, so every fork joins without a seam.
 * Living limbs end in leaves (more leaves for more speakers today), extinct
 * ones in a dry forked twig, revived ones in a new bud.
 */
const Branches = memo(function Branches({ layout, x, year, selectedId, related }: BranchProps) {
  const selected = selectedId ? byId.get(selectedId) : undefined
  const firstRows = new Set(layout.sections.filter((s) => !s.isBranch).map((s) => s.group.id))
  return (
    <g>
      <defs>
        {layout.sections.map((s) => (
          <linearGradient key={s.group.id} id={`bark-${s.group.id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={shade(s.group.color, 0.32)} />
            <stop offset="0.55" stopColor={s.group.color} />
            <stop offset="1" stopColor={s.group.color} />
          </linearGradient>
        ))}
      </defs>

      {layout.sections.map((s) => (
        <line key={s.group.id} className="section__rule" x1={0} x2={x(MAX_YEAR) + PAD_R} y1={s.y0 + 0.5} y2={s.y0 + 0.5} />
      ))}

      <FamilyTrunks layout={layout} x={x} related={related} />

      {layout.connectors.map((c) => {
        const child = c.child.lang
        const parent = c.parent.lang
        const dim = related && !(related.has(child.id) && related.has(parent.id))
        const xc = x(child.start)
        const yp = c.parent.y
        const yc = c.child.y
        const dy = yc - yp
        const wc = thickness(child.id)
        if (c.gap) {
          // The record goes quiet between parent and child: a slender, paler
          // shoot from the parent's tip.
          // Daughters further down leave the parent's limb earlier, so they
          // fan out along it instead of all leaving from its very tip.
          const tip = x(parent.end ?? MAX_YEAR) - 2
          const xs = Math.max(x(parent.start) + 6, Math.min(tip, xc - Math.min(260, Math.max(30, dy * 1.1))))
          const k = Math.max(8, (xc - xs) * 0.55)
          const ws = Math.min(widthAt(parent, xs, x) * 0.8, wc)
          const d = ribbon([xs, yp], [xs + k, yp], [xc - k * 0.55, yc], [xc, yc], Math.max(1.4, ws), Math.max(1.6, wc * 0.85))
          return (
            <path
              key={child.id}
              d={d}
              className={`branch is-gap${dim ? ' is-dim' : ''}`}
              fill={shade(c.child.group.color, 0.1)}
            />
          )
        }
        // Leave the parent's limb well before the split and sweep down in a
        // long, gentle curve: the further down the daughter, the earlier it
        // leaves, so many daughters fan out like a bough instead of dropping
        // in a bundle.
        const xs = Math.max(x(parent.start) + 6, xc - Math.min(220, Math.max(24, dy * 1.05)))
        const k = Math.max(8, (xc - xs) * 0.55)
        const ws = Math.min(widthAt(parent, xs, x) * 0.85, wc * 1.05)
        const d = ribbon([xs, yp], [xs + k, yp], [xc - k * 0.55, yc], [xc, yc], Math.max(1.4, ws), wc)
        return (
          <path
            key={child.id}
            d={d}
            className={`branch${child.proto ? ' is-proto' : ''}${dim ? ' is-dim' : ''}`}
            fill={shade(c.child.group.color, 0.18)}
          />
        )
      })}

      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = x(l.start)
        const x1 = Math.max(x0 + 2, x(l.end ?? MAX_YEAR))
        const y = r.y
        const alive = isAlive(l, year)
        const living = l.end == null
        const dim = related ? !related.has(l.id) : false
        const sel = l.id === selectedId
        const w0 = thickness(l.id)
        const w1 = tipWidth(l)
        const h0 = w0 / 2
        const h1 = w1 / 2
        // Gently concave edges and a rounded tip, like a real limb.
        const mx = x0 + (x1 - x0) * 0.35
        const hm = h1 + (h0 - h1) * 0.45
        const limb =
          `M${x0},${y - h0}Q${mx},${y - hm} ${x1},${y - h1}` +
          `A${h1},${h1} 0 0 1 ${x1},${y + h1}` +
          `Q${mx},${y + hm} ${x0},${y + h0}Z`
        const cls = `bar${alive ? ' is-alive' : ''}${l.proto ? ' is-proto' : ''}${living ? ' is-living' : ''}${dim ? ' is-dim' : ''}${sel ? ' is-selected' : ''}`
        return (
          <g key={l.id} className={cls} fill={r.group.color} stroke={r.group.color}>
            {firstRows.has(l.id) && (
              <g className="bar__roots" fill={shade(r.group.color, 0.25)}>
                <path d={ribbon([x0, y], [x0 - 5, y + 1], [x0 - 9, y + 5], [x0 - 15, y + 10], w0 * 0.7, 0.8)} />
                <path d={ribbon([x0, y], [x0 - 2, y + 3], [x0 - 2, y + 8], [x0 - 4, y + 14], w0 * 0.55, 0.7)} />
                <path d={ribbon([x0, y], [x0 - 6, y], [x0 - 12, y + 1], [x0 - 19, y + 4], w0 * 0.6, 0.7)} />
              </g>
            )}
            {l.afterlife && l.end != null && <line className="bar__after" x1={x1 + 14} x2={x(MAX_YEAR)} y1={y} y2={y} />}
            {l.revived && l.end != null && (
              <g className="bar__bud">
                <Leaves x={x(MAX_YEAR)} y={y} n={1} scale={0.6} />
              </g>
            )}
            {l.proto ? (
              <path className="bar__ghost" d={limb} />
            ) : (
              <>
                <path className="bar__limb" d={limb} fill={`url(#bark-${r.group.id})`} />
                {w0 > 3.6 && (
                  <path
                    className="bar__sheen"
                    d={`M${x0 + h0},${y - h0 * 0.42}Q${mx},${y - hm * 0.45} ${x1 - h1},${y - h1 * 0.4}`}
                    strokeWidth={Math.max(0.7, w0 * 0.16)}
                  />
                )}
              </>
            )}
            {(firstRows.has(l.id) || sel) && (
              <circle className="bar__knot" cx={x0} cy={y} r={h0 + (sel ? 2 : 0.3)} fill={shade(r.group.color, 0.32)} />
            )}
            {living ? (
              <Leaves x={x1 + h1 * 0.4} y={y} n={leafCount(l.speakers)} scale={sel ? 1.2 : 1} />
            ) : (
              <text className="bar__dagger" x={x1 + h1 + 3} y={y + 4}>
                †
              </text>
            )}
          </g>
        )
      })}

      {selected?.contacts?.map((cid) => {
        const from = layout.rowById.get(cid)
        const to = layout.rowById.get(selected.id)
        if (!from || !to) return null
        const lo = Math.max(from.lang.start, selected.start)
        const hi = Math.min(from.lang.end ?? MAX_YEAR, selected.end ?? MAX_YEAR)
        const xs = x(hi >= lo ? (lo + hi) / 2 : selected.start)
        const bulge = Math.min(220, Math.abs(to.y - from.y) * 0.3 + 40)
        return (
          <path
            key={`contact-${cid}`}
            className="contact-arc"
            d={`M${xs},${from.y}C${xs + bulge},${from.y} ${xs + bulge},${to.y} ${xs},${to.y}`}
          />
        )
      })}
    </g>
  )
})

type LabelProps = BranchProps & {
  word: WordId | null
  /** Left edge of the visible area, in drawing coordinates. */
  edge: number
  onSelect: (id: string | null) => void
}

const NAME_W = 7.6 // average px per character at the name size

/**
 * Names sit above their bars. When a limb runs off the left edge, its name
 * stays pinned at the edge so it remains readable. All pinned names live in
 * one group that moves as a unit, so a pan frame changes a single attribute
 * instead of re-placing every pinned name; a row only re-renders when it
 * crosses the edge.
 */
const Labels = memo(function Labels({ layout, x, year, word, selectedId, related, edge, onSelect }: LabelProps) {
  const free: ReactElement[] = []
  const pinned: ReactElement[] = []
  for (const r of layout.rows) {
    const l = r.lang
    const x0 = x(l.start)
    const x1 = x(l.end ?? MAX_YEAR)
    const isPinned = x1 > edge && x0 - 2 < edge
    const row = (
      <LabelRow
        key={l.id}
        id={l.id}
        y={r.y}
        nx={isPinned ? 0 : x0 - 2}
        w={word ? wordFor(l.id, word) : undefined}
        alive={isAlive(l, year)}
        dim={related ? !related.has(l.id) : false}
        sel={l.id === selectedId}
        onSelect={onSelect}
      />
    )
    ;(isPinned ? pinned : free).push(row)
  }
  return (
    <g>
      <BarHits layout={layout} x={x} onSelect={onSelect} />
      <g>{free}</g>
      <g transform={`translate(${edge},0)`}>{pinned}</g>
    </g>
  )
})

/** Tap targets along every limb; they never move relative to the drawing. */
const BarHits = memo(function BarHits({
  layout,
  x,
  onSelect,
}: {
  layout: Layout
  x: (y: number) => number
  onSelect: (id: string | null) => void
}) {
  return (
    <g className="bar-hits">
      {layout.rows.map((r) => {
        const x0 = x(r.lang.start)
        const x1 = x(r.lang.end ?? MAX_YEAR)
        return (
          <rect
            key={r.lang.id}
            className="name__hit"
            x={x0 - 8}
            y={r.y - 22}
            width={Math.max(24, x1 - x0 + 28)}
            height={30}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(r.lang.id)
            }}
          />
        )
      })}
    </g>
  )
})

type LabelRowProps = {
  id: string
  y: number
  nx: number
  w?: string
  alive: boolean
  dim: boolean
  sel: boolean
  onSelect: (id: string | null) => void
}

const LabelRow = memo(function LabelRow({ id, y, nx, w, alive, dim, sel, onSelect }: LabelRowProps) {
  const l = byId.get(id)!
  const textW = l.name.length * NAME_W + (w ? w.length * 7 + 18 : 0)
  return (
    <g
      className={`name${alive ? ' is-alive' : ''}${l.proto ? ' is-proto' : ''}${dim ? ' is-dim' : ''}${sel ? ' is-selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(id)
      }}
    >
      <rect className="name__hit" x={nx - 8} y={y - 22} width={textW + 16} height={30} />
      <text x={nx} y={y - thickness(id) / 2 - 5}>
        <tspan className="name__text">{l.name}</tspan>
        {w && (
          <tspan className="name__word" dx={9}>
            {w}
          </tspan>
        )}
      </text>
    </g>
  )
})
