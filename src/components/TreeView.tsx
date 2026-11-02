import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WordId } from '../types'
import { byId, childrenOf, isAlive, lineage } from '../data'
import { wordFor } from '../data/words'
import { AXIS_TICKS, MAX_YEAR, clampYear, formatYearShort, fractionToYear } from '../lib/time'
import { BAR_DY, HEADER_H, PAD_L, PAD_R, buildLayout, makeX, sectionOf, type Layout } from '../lib/layout'

type Props = {
  year: number
  word: WordId | null
  selectedId: string | null
  focusSeq: number
  onSelect: (id: string | null) => void
  onYear: (y: number) => void
}

const AXIS_H = 32
const MIN_TRACK = 700
const MAX_TRACK = 9000
const PHONE_TRACK = 1000
const PANEL_W = 412

function descendants(id: string, out = new Set<string>()): Set<string> {
  for (const k of childrenOf.get(id) ?? []) {
    out.add(k.id)
    descendants(k.id, out)
  }
  return out
}

export function TreeView({ year, word, selectedId, focusSeq, onSelect, onYear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth))
  const [trackW, setTrackW] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const anchor = useRef<{ f: number; px: number } | null>(null)
  const pendingFocus = useRef(false)

  const layout = useMemo(() => buildLayout(collapsed), [collapsed])
  const isPhone = vw < 760
  const fitW = Math.max(MIN_TRACK, vw - PAD_L - PAD_R - 8)
  const tw = trackW ?? (isPhone ? PHONE_TRACK : fitW)
  const x = useMemo(() => makeX(tw), [tw])
  // Room to scroll the far end of history out from under the detail panel.
  const width = PAD_L + tw + PAD_R + (selectedId && !isPhone ? PANEL_W : 0)

  // Viewport width, for fitting and the phone layout.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setVw(el.clientWidth))
    ro.observe(el)
    setVw(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Track horizontal scroll (throttled to frames) so names can stay readable.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setScrollLeft(el.scrollLeft)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  /** Stretch time, keeping the moment under `px` (viewport x) in place. */
  const zoomTo = useCallback(
    (next: number, px?: number) => {
      const el = scrollRef.current
      if (!el) return
      const clamped = Math.round(Math.min(MAX_TRACK, Math.max(MIN_TRACK, next)))
      const at = px ?? el.clientWidth / 2
      anchor.current = { f: (el.scrollLeft + at - PAD_L) / tw, px: at }
      setTrackW(clamped)
    },
    [tw],
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = PAD_L + a.f * tw - a.px
    setScrollLeft(el.scrollLeft)
  }, [tw])

  // Ctrl / ⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms time.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(tw * Math.exp(-e.deltaY * 0.01), e.clientX - r.left)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tw, zoomTo])

  // Open with the current year in view.
  const opened = useRef(false)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || opened.current || el.clientWidth === 0) return
    opened.current = true
    if (width > el.clientWidth) el.scrollLeft = x(year) - el.clientWidth * 0.5
    setScrollLeft(el.scrollLeft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw])

  // Keep the year line on screen while scrubbing or playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const xs = x(year)
    const m = Math.min(80, el.clientWidth * 0.12)
    if (xs < el.scrollLeft + m) el.scrollLeft = xs - m
    else if (xs > el.scrollLeft + el.clientWidth - m) el.scrollLeft = xs - el.clientWidth + m
    setScrollLeft(el.scrollLeft)
  }, [year, x])

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
    const el = scrollRef.current
    if (!pendingFocus.current || !el || !selectedId) return
    const row = layout.rowById.get(selectedId)
    if (!row) return
    pendingFocus.current = false
    const left = Math.max(0, x(row.lang.start) - (isPhone ? 24 : 120))
    const top = row.y - (isPhone ? el.clientHeight * 0.16 : el.clientHeight * 0.38)
    // Glide for short hops; jump straight there across long distances.
    const far = Math.abs(top - el.scrollTop) > el.clientHeight * 2
    el.scrollTo({ left, top: Math.max(0, top), behavior: far ? 'auto' : 'smooth' })
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

  // Scrub by pressing or dragging along the axis.
  function yearAt(clientX: number): number {
    const el = scrollRef.current!
    const px = clientX - el.getBoundingClientRect().left + el.scrollLeft
    return clampYear(fractionToYear((px - PAD_L) / tw))
  }

  const yearX = x(year)
  // Drop ticks that would crowd their neighbours (or the "Today" label).
  const ticks = useMemo(() => {
    const out: number[] = []
    let last = -Infinity
    for (const t of AXIS_TICKS) {
      if (x(t) - last < 56 || x(MAX_YEAR) - x(t) < 56) continue
      out.push(t)
      last = x(t)
    }
    return out
  }, [x])

  return (
    <div className="tree">
      <div ref={scrollRef} className="tree__scroll" onClick={() => onSelect(null)}>
        <svg
          className="tree__axis"
          width={width}
          height={AXIS_H}
          role="slider"
          aria-label="Year on the tree"
          aria-valuenow={year}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            onYear(yearAt(e.clientX))
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) onYear(yearAt(e.clientX))
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <rect className="axis__bg" width={width} height={AXIS_H} />
          {ticks.map((t) => (
            <g key={t} transform={`translate(${x(t)},0)`} className="axis__tick">
              <line y1={AXIS_H - 7} y2={AXIS_H} />
              <text y={AXIS_H - 13}>{formatYearShort(t)}</text>
            </g>
          ))}
          <g transform={`translate(${x(MAX_YEAR)},0)`} className="axis__tick">
            <text y={AXIS_H - 13}>Today</text>
          </g>
          <g transform={`translate(${yearX},0)`} className="axis__now">
            <path d={`M-6,${AXIS_H - 9}L6,${AXIS_H - 9}L0,${AXIS_H}z`} />
          </g>
        </svg>

        <div className="tree__body" style={{ width, height: layout.height }}>
          <svg className="tree__svg" width={width} height={layout.height} role="img" aria-label="Time-scaled family tree of languages">
            <Grid x={x} height={layout.height} />
            <Branches layout={layout} x={x} year={year} selectedId={selectedId} related={related} />
            <line className="tree__year" x1={yearX} x2={yearX} y1={0} y2={layout.height} />
            <Labels
              layout={layout}
              x={x}
              year={year}
              word={word}
              selectedId={selectedId}
              related={related}
              scrollLeft={scrollLeft}
              onSelect={onSelect}
            />
          </svg>

          {layout.sections.map((s) => (
            <div key={s.group.id} className="section" style={{ top: s.y0, height: HEADER_H }}>
              <div className="section__head">
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
            </div>
          ))}
        </div>
      </div>

      <div className={`tree__tools${selectedId ? ' is-shifted' : ''}`}>
        <button type="button" onClick={toggleAll}>
          {allFolded ? 'Unfold all' : 'Fold all'}
        </button>
        <span className="tree__tools-sep" />
        <button type="button" onClick={() => zoomTo(tw / 1.5)} aria-label="Compress time" title="Compress time">
          −
        </button>
        <button type="button" onClick={() => zoomTo(isPhone ? PHONE_TRACK : fitW)} title="Fit all of history">
          Fit
        </button>
        <button type="button" onClick={() => zoomTo(tw * 1.5)} aria-label="Stretch time" title="Stretch time">
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

/** Bars, connectors and contact arcs: everything that does not move on scroll. */
const Branches = memo(function Branches({ layout, x, year, selectedId, related }: BranchProps) {
  const selected = selectedId ? byId.get(selectedId) : undefined
  return (
    <g>
      {layout.sections.map((s) => (
        <line key={s.group.id} className="section__rule" x1={0} x2="100%" y1={s.y0 + 0.5} y2={s.y0 + 0.5} />
      ))}

      {layout.connectors.map((c) => {
        const dim = related && !(related.has(c.child.lang.id) && related.has(c.parent.lang.id))
        const xp = x(c.at)
        const xc = x(c.child.lang.start)
        const y0 = c.parent.y + 3
        const y1 = c.child.y
        const r = Math.min(8, xc - xp)
        const d =
          r < 2
            ? `M${xp},${y0}V${y1 - 4.5}`
            : `M${xp},${y0}V${y1 - r}Q${xp},${y1} ${xp + r},${y1}H${xc}`
        return (
          <path
            key={c.child.lang.id}
            d={d}
            className={`conn${c.gap ? ' is-gap' : ''}${dim ? ' is-dim' : ''}`}
            stroke={c.child.group.color}
          />
        )
      })}

      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = x(l.start)
        const x1 = x(l.end ?? MAX_YEAR)
        const alive = isAlive(l, year)
        const dim = related ? !related.has(l.id) : false
        const sel = l.id === selectedId
        return (
          <g
            key={l.id}
            className={`bar${alive ? ' is-alive' : ''}${l.proto ? ' is-proto' : ''}${dim ? ' is-dim' : ''}${sel ? ' is-selected' : ''}`}
            stroke={r.group.color}
          >
            {l.afterlife && l.end != null && <line className="bar__after" x1={x1 + 10} x2={x(MAX_YEAR)} y1={r.y} y2={r.y} />}
            <line className="bar__line" x1={x0} x2={Math.max(x0 + 1, x1)} y1={r.y} y2={r.y} />
            <circle className="bar__start" cx={x0} cy={r.y} r={sel ? 5.5 : 4.5} fill={r.group.color} />
            {l.end != null && (
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
  scrollLeft: number
  onSelect: (id: string | null) => void
}

const NAME_W = 7.6 // average px per character at the name size

/** Names sit above their bars and slide along to stay readable while scrolled. */
function Labels({ layout, x, year, word, selectedId, related, scrollLeft, onSelect }: LabelProps) {
  const edge = scrollLeft + 12
  return (
    <g>
      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = x(l.start)
        const x1 = x(l.end ?? MAX_YEAR)
        const w = word ? wordFor(l.id, word) : undefined
        const textW = l.name.length * NAME_W + (w ? w.length * 7 + 18 : 0)
        // Slide right with the scroll while the bar is still in view.
        const nx = x0 < edge && x1 > edge ? edge : x0 - 2
        const alive = isAlive(l, year)
        const dim = related ? !related.has(l.id) : false
        const sel = l.id === selectedId
        return (
          <g
            key={l.id}
            className={`name${alive ? ' is-alive' : ''}${l.proto ? ' is-proto' : ''}${dim ? ' is-dim' : ''}${sel ? ' is-selected' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(l.id)
            }}
          >
            <rect
              className="name__hit"
              x={Math.min(x0, nx) - 8}
              y={r.y - 22}
              width={Math.max(x1 - x0, textW + (nx - x0)) + 20}
              height={30}
            />
            <text x={nx} y={r.y - BAR_DY - 3}>
              <tspan className="name__text">{l.name}</tspan>
              {w && <tspan className="name__word" dx={9}>{w}</tspan>}
            </text>
          </g>
        )
      })}
    </g>
  )
}
