import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import 'd3-transition'
import type { WordId } from '../types'
import { byId, childrenOf, isAlive, lineage } from '../data'
import { wordFor } from '../data/words'
import { AXIS_TICKS, MAX_YEAR, clampYear, formatYearShort, fractionToYear } from '../lib/time'
import { HEADER_H, PAD_L, PAD_R, buildLayout, makeX, sectionOf, type Layout } from '../lib/layout'

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
        // A new touch or click stops any glide still running.
        if (e.sourceEvent) stopGlide()
        samples.length = 0
      })
      .on('zoom', (e) => {
        tRef.current = e.transform
        setT(e.transform)
        const src = e.sourceEvent as Event | null
        if (src && src.type === 'touchmove' && (src as TouchEvent).touches.length === 1) {
          samples.push({ x: e.transform.x, y: e.transform.y, k: e.transform.k, t: performance.now() })
          if (samples.length > 6) samples.shift()
        }
      })
      .on('end', (e) => {
        const src = e.sourceEvent as Event | null
        if (src && src.type === 'touchend') glide()
      })
    zoomRef.current = z
    const sel = select(el)
    sel.call(z)

    // Momentum: a one-finger flick keeps the tree gliding and slowing down,
    // like a native scroll view. It stops at the edges and on the next touch.
    const samples: { x: number; y: number; k: number; t: number }[] = []
    let raf = 0
    function stopGlide() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    function glide() {
      const last = samples[samples.length - 1]
      const first = samples[0]
      samples.length = 0
      if (!last || !first || last === first || last.k !== first.k) return
      const dt = last.t - first.t
      // Only a flick that is still moving when the finger lifts.
      if (dt <= 0 || performance.now() - last.t > 80) return
      let vx = (last.x - first.x) / dt
      let vy = (last.y - first.y) / dt
      const speed = Math.hypot(vx, vy)
      if (speed < 0.15) return
      const cap = 4.5
      if (speed > cap) {
        vx *= cap / speed
        vy *= cap / speed
      }
      let prev = performance.now()
      const step = (now: number) => {
        const ms = Math.min(48, now - prev)
        prev = now
        const before = tRef.current
        z.translateBy(sel, (vx * ms) / before.k, (vy * ms) / before.k)
        const after = tRef.current
        // Hit an edge on one axis: stop moving along it.
        if (Math.abs(after.x - before.x) < 0.01) vx = 0
        if (Math.abs(after.y - before.y) < 0.01) vy = 0
        const decay = Math.pow(0.9965, ms)
        vx *= decay
        vy *= decay
        raf = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0
      }
      raf = requestAnimationFrame(step)
    }
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
    if (next.has(id)) next.delete(id)
    else next.add(id)
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
  // Axis ticks in screen space. Labels near an edge are nudged inwards rather
  // than cut off, and any label that would then crowd its neighbour is dropped.
  const ticks = useMemo(() => {
    const out: { tick: number; sx: number; lx: number; label: string }[] = []
    const todayX = t.applyX(x(MAX_YEAR))
    let last = -Infinity
    for (const tick of AXIS_TICKS) {
      const sx = t.applyX(x(tick))
      if (sx < -30 || sx > size.w + 30) continue
      const label = formatYearShort(tick)
      const half = label.length * 3.4
      const lx = Math.min(Math.max(sx, half + 4), size.w - half - 4)
      if (lx - last < 58 || todayX - lx < 52) continue
      out.push({ tick, sx, lx, label })
      last = lx
    }
    return out
  }, [t, x, size.w])

  // Names slide in 24-unit steps, so most pan frames re-render none of them.
  const edge = Math.round(t.invertX(10) / 24) * 24
  const viewTop = t.invertY(0)
  const viewBottom = t.invertY(size.h)

  return (
    <div ref={rootRef} className="tree" onClick={() => onSelect(null)}>
      <svg className="tree__svg" width="100%" height="100%" role="img" aria-label="Time-scaled family tree of languages">
        <g transform={t.toString()}>
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
              className="section__head"
              style={{ transform: `translate(0px, ${t.applyY(s.y0)}px) scale(${t.k})` }}
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
                <span className="section__count">{s.count}</span>
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
          const sx = t.applyX(x(MAX_YEAR))
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
        <g transform={`translate(${t.applyX(yearX)},0)`} className="axis__now">
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
  return Math.min(10, 2.2 + 1.55 * Math.log2(1 + spread(id)))
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
  return l.end == null ? Math.max(1.8, w0 * 0.5) : Math.max(1.1, w0 * 0.3)
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
  const firstRows = new Set(layout.sections.map((s) => s.group.id))
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
        <line key={s.group.id} className="section__rule" x1={0} x2="100%" y1={s.y0 + 0.5} y2={s.y0 + 0.5} />
      ))}

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
          const xs = x(parent.end ?? MAX_YEAR) - 2
          const k = Math.max(6, (xc - xs) * 0.6)
          const d = ribbon([xs, yp], [xs + k, yp], [xc - k * 0.55, yc], [xc, yc], Math.max(1.2, tipWidth(parent)), Math.max(1.4, wc * 0.8))
          return (
            <path
              key={child.id}
              d={d}
              className={`branch is-gap${dim ? ' is-dim' : ''}`}
              fill={shade(c.child.group.color, 0.1)}
            />
          )
        }
        // Leave the parent's limb a little before the split and sweep down.
        const xs = Math.max(x(parent.start) + 4, xc - Math.min(70, Math.max(14, dy * 0.55)))
        const k = Math.max(6, (xc - xs) * 0.62)
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
              <>
                <path className="bar__ghost" d={limb} />
                <line className="bar__proto" x1={x0 + w0} x2={x1} y1={y} y2={y} />
              </>
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
            <circle className="bar__knot" cx={x0} cy={y} r={h0 + (sel ? 2 : 0.3)} fill={shade(r.group.color, 0.32)} />
            {living ? (
              <Leaves x={x1 + h1 * 0.4} y={y} n={leafCount(l.speakers)} scale={sel ? 1.2 : 1} />
            ) : (
              <>
                {!l.proto && (
                  <path className="bar__twig" d={`M${x1},${y}l5,-3.4m-5,3.4l6,1.8m-2.6,-0.8l2.6,-2.6`} />
                )}
                <text className="bar__dagger" x={x1 + (l.proto ? 3 : 9)} y={y + 4.5}>
                  †
                </text>
              </>
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
 * Names sit above their bars and slide along to stay readable while scrolled.
 * Each row is memoised, so a scroll frame only re-renders the few names that
 * actually move.
 */
const Labels = memo(function Labels({ layout, x, year, word, selectedId, related, edge, onSelect }: LabelProps) {
  return (
    <g>
      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = x(l.start)
        const x1 = x(l.end ?? MAX_YEAR)
        return (
          <LabelRow
            key={l.id}
            id={l.id}
            y={r.y}
            x0={x0}
            x1={x1}
            nx={x0 < edge && x1 > edge ? edge : x0 - 2}
            w={word ? wordFor(l.id, word) : undefined}
            alive={isAlive(l, year)}
            dim={related ? !related.has(l.id) : false}
            sel={l.id === selectedId}
            onSelect={onSelect}
          />
        )
      })}
    </g>
  )
})

type LabelRowProps = {
  id: string
  y: number
  x0: number
  x1: number
  nx: number
  w?: string
  alive: boolean
  dim: boolean
  sel: boolean
  onSelect: (id: string | null) => void
}

const LabelRow = memo(function LabelRow({ id, y, x0, x1, nx, w, alive, dim, sel, onSelect }: LabelRowProps) {
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
      <rect className="name__hit" x={Math.min(x0, nx) - 8} y={y - 22} width={Math.max(x1 - x0, textW + (nx - x0)) + 20} height={30} />
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
