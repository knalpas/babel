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
      .on('zoom', (e) => {
        tRef.current = e.transform
        setT(e.transform)
      })
    zoomRef.current = z
    const sel = select(el)
    sel.call(z)
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
      sel.on('.zoom', null).on('wheel.pan', null)
    }
  }, [])

  // Keep the tree on screen: panning stops at its edges (with room to move the
  // far end of history out from under the detail panel on desktop).
  useEffect(() => {
    const el = rootRef.current
    const z = zoomRef.current
    if (!el || !z) return
    const extra = selectedId && !isPhone ? PANEL_W : 0
    z.translateExtent([
      [-16, -AXIS_H - 8],
      [chartW + 16 + extra, layout.height + 80],
    ])
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
    const top = tRef.current.invertY(AXIS_H)
    select(el)
      .transition()
      .duration(350)
      .call(z.transform, zoomIdentity.translate((el.clientWidth - chartW * fitK) / 2, AXIS_H - top * fitK).scale(fitK))
  }

  function axisYear(clientX: number): number {
    const el = rootRef.current!
    const px = tRef.current.invertX(clientX - el.getBoundingClientRect().left)
    return clampYear(fractionToYear((px - PAD_L) / track))
  }

  const yearX = x(year)
  // Axis ticks in screen space, thinned so labels never collide.
  const ticks = useMemo(() => {
    const out: number[] = []
    let last = -Infinity
    const today = t.applyX(x(MAX_YEAR))
    for (const tick of AXIS_TICKS) {
      const sx = t.applyX(x(tick))
      if (sx - last < 56 || today - sx < 56) continue
      out.push(tick)
      last = sx
    }
    return out
  }, [t, x])

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
        {ticks.map((tick) => (
          <g key={tick} transform={`translate(${t.applyX(x(tick))},0)`} className="axis__tick">
            <line y1={AXIS_H - 7} y2={AXIS_H} />
            <text y={AXIS_H - 13}>{formatYearShort(tick)}</text>
          </g>
        ))}
        <g transform={`translate(${t.applyX(x(MAX_YEAR))},0)`} className="axis__tick">
          <text y={AXIS_H - 13}>Today</text>
        </g>
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

/** A small leaf, drawn pointing right from the tip of a living branch. */
const LEAF = 'M0,0C3,-5.5 9,-8 15,-6.5C12.5,-1.5 7,2.5 0,0Z'

/**
 * Branches, twigs and leaves: everything that does not move on scroll.
 * Each language is a limb that tapers towards its tip; living limbs end in a
 * leaf, extinct ones in a bare twig and a dagger. Daughters curve off their
 * parent's limb where they split, like branches off a bough.
 */
const Branches = memo(function Branches({ layout, x, year, selectedId, related }: BranchProps) {
  const selected = selectedId ? byId.get(selectedId) : undefined
  const firstRows = new Set(layout.sections.map((s) => s.group.id))
  return (
    <g>
      {layout.sections.map((s) => (
        <line key={s.group.id} className="section__rule" x1={0} x2="100%" y1={s.y0 + 0.5} y2={s.y0 + 0.5} />
      ))}

      {layout.connectors.map((c) => {
        const dim = related && !(related.has(c.child.lang.id) && related.has(c.parent.lang.id))
        const xc = x(c.child.lang.start)
        const yp = c.parent.y
        const yc = c.child.y
        const dy = yc - yp
        const w = thickness(c.child.lang.id)
        // Leave the parent's limb a little before the split and sweep down into it.
        const xs = c.gap
          ? x(c.parent.lang.end ?? MAX_YEAR) - 3
          : Math.max(x(c.parent.lang.start) + 4, xc - Math.min(64, Math.max(12, dy * 0.5)))
        const k = Math.max(4, (xc - xs) * 0.6)
        const d = `M${xs},${yp}C${xs + k},${yp} ${xc - k * 0.6},${yc} ${xc},${yc}`
        return (
          <path
            key={c.child.lang.id}
            d={d}
            className={`limb${c.gap ? ' is-gap' : ''}${c.child.lang.proto ? ' is-proto' : ''}${dim ? ' is-dim' : ''}`}
            stroke={c.child.group.color}
            strokeWidth={Math.min(4.5, Math.max(1.4, Math.min(w, thickness(c.parent.lang.id)) * 0.55))}
          />
        )
      })}

      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = x(l.start)
        const x1 = Math.max(x0 + 2, x(l.end ?? MAX_YEAR))
        const alive = isAlive(l, year)
        const living = l.end == null
        const dim = related ? !related.has(l.id) : false
        const sel = l.id === selectedId
        const w0 = thickness(l.id)
        const w1 = living ? Math.max(1.6, w0 * 0.5) : Math.max(1, w0 * 0.3)
        const cls = `bar${alive ? ' is-alive' : ''}${l.proto ? ' is-proto' : ''}${living ? ' is-living' : ''}${dim ? ' is-dim' : ''}${sel ? ' is-selected' : ''}`
        return (
          <g key={l.id} className={cls} fill={r.group.color} stroke={r.group.color}>
            {firstRows.has(l.id) && (
              <path
                className="bar__roots"
                d={`M${x0},${r.y}c-3,3 -5,7 -11,10M${x0},${r.y}c-1,4 -1,8 -3,13M${x0},${r.y}c-5,1 -10,1 -15,4`}
              />
            )}
            {l.afterlife && l.end != null && <line className="bar__after" x1={x1 + 12} x2={x(MAX_YEAR)} y1={r.y} y2={r.y} />}
            <path
              className={l.proto ? 'bar__ghost' : 'bar__limb'}
              d={`M${x0},${r.y - w0 / 2}L${x1},${r.y - w1 / 2}L${x1},${r.y + w1 / 2}L${x0},${r.y + w0 / 2}Z`}
            />
            {l.proto && <line className="bar__proto" x1={x0 + w0} x2={x1} y1={r.y} y2={r.y} />}
            <circle className="bar__knot" cx={x0} cy={r.y} r={w0 / 2 + (sel ? 2 : 0.5)} />
            {living ? (
              <g className="bar__leaf" transform={`translate(${x1 - 1},${r.y}) rotate(-18) scale(${sel ? 1.25 : 1})`}>
                <path d={LEAF} />
                <path className="bar__vein" d="M1,-0.5C5,-2.5 9,-4 13,-5.5" />
              </g>
            ) : (
              <text className="bar__dagger" x={x1 + 3} y={r.y + 4.5}>
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
