import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import 'd3-transition'
import type { WordId } from '../types'
import { byId, childrenOf, isAlive, lineage } from '../data'
import { wordFor } from '../data/words'
import { AXIS_TICKS, MAX_YEAR, clampYear, formatYearShort, fractionToYear } from '../lib/time'
import { CHART_W, PAD_L, ROW_H, TRACK_W, buildLayout, xOf, type Layout } from '../lib/layout'

type Props = {
  year: number
  word: WordId | null
  selectedId: string | null
  focusSeq: number
  onSelect: (id: string | null) => void
  onYear: (y: number) => void
}

const AXIS_H = 30

function descendants(id: string, out = new Set<string>()): Set<string> {
  for (const k of childrenOf.get(id) ?? []) {
    out.add(k.id)
    descendants(k.id, out)
  }
  return out
}

export function TreeView({ year, word, selectedId, focusSeq, onSelect, onYear }: Props) {
  const layout = useMemo(() => buildLayout(), [])
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const tRef = useRef(t)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .filter((e: Event) => {
        // Let a plain wheel pan vertically like a document; zoom with ctrl/pinch.
        if (e.type === 'wheel') return (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey
        return !(e as MouseEvent).button
      })
      .on('zoom', (e) => {
        tRef.current = e.transform
        setT(e.transform)
      })
    zoomRef.current = z
    const sel = select(svg)
    sel.call(z).on('dblclick.zoom', null)
    sel.on('wheel.pan', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      z.translateBy(sel, -e.deltaX / tRef.current.k, -e.deltaY / tRef.current.k)
    }, { passive: false })

    // Open readable: full scale on desktop, framed on the recent past (where
    // most of the tree is), with the year line in view.
    const vw = svg.clientWidth || 1000
    const wide = vw >= 900
    const k = wide ? 0.9 : 0.62
    const right = vw - (xOf(MAX_YEAR) + 40) * k
    const tx = Math.max(right, Math.min(0, vw * 0.5 - xOf(year) * k))
    sel.call(z.transform, zoomIdentity.translate(tx, AXIS_H).scale(k))
    return () => {
      sel.on('.zoom', null).on('wheel.pan', null)
    }
    // Initial framing only; later year changes pan via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fly to the selected language.
  useEffect(() => {
    if (!focusSeq || !selectedId) return
    const svg = svgRef.current
    const z = zoomRef.current
    const row = layout.rowById.get(selectedId)
    if (!svg || !z || !row) return
    const vw = svg.clientWidth || 1000
    const vh = svg.clientHeight || 700
    const k = Math.max(tRef.current.k, vw < 700 ? 0.6 : 0.85)
    const panelW = vw >= 900 ? 400 : 0
    const xs = xOf(row.lang.start)
    const tx = Math.min(80 - (xs - 170) * k, (vw - panelW) * 0.42 - xs * k)
    const ty = (vw < 760 ? vh * 0.18 : vh * 0.42) - row.y * k
    select(svg)
      .transition()
      .duration(650)
      .call(z.transform, zoomIdentity.translate(tx, ty).scale(k))
  }, [focusSeq, selectedId, layout])

  // Keep the year line on screen while scrubbing.
  useEffect(() => {
    const svg = svgRef.current
    const z = zoomRef.current
    if (!svg || !z) return
    const vw = svg.clientWidth || 1000
    const sx = tRef.current.applyX(xOf(year))
    const margin = Math.min(120, vw * 0.15)
    if (sx < margin) z.translateBy(select(svg), (margin - sx) / tRef.current.k, 0)
    else if (sx > vw - margin) z.translateBy(select(svg), (vw - margin - sx) / tRef.current.k, 0)
  }, [year])

  const related = useMemo(() => {
    if (!selectedId) return null
    const s = new Set(lineage(selectedId).map((l) => l.id))
    for (const d of descendants(selectedId)) s.add(d)
    return s
  }, [selectedId])

  const yearX = xOf(year)

  function axisClick(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const x = tRef.current.invertX(e.clientX - box.left)
    onYear(clampYear(fractionToYear((x - PAD_L) / TRACK_W)))
  }

  return (
    <div className="tree">
      <svg
        ref={svgRef}
        className="tree__svg"
        role="img"
        aria-label="Time-scaled family tree of languages"
        onClick={() => onSelect(null)}
      >
        <g transform={t.toString()}>
          <TreeContent
            layout={layout}
            year={year}
            word={word}
            selectedId={selectedId}
            related={related}
            onSelect={onSelect}
          />
          <line className="tree__year" x1={yearX} x2={yearX} y1={0} y2={layout.height} />
        </g>

        {/* Axis pinned to the top, following horizontal pan and zoom only. */}
        <g className="axis">
          <rect className="axis__bg" x={0} y={0} width="100%" height={AXIS_H} onClick={(e) => {
            e.stopPropagation()
            axisClick(e)
          }} />
          {AXIS_TICKS.map((y) => {
            const x = t.applyX(xOf(y))
            return (
              <g key={y} transform={`translate(${x},0)`} className="axis__tick">
                <line y1={AXIS_H - 6} y2={AXIS_H} />
                <text y={AXIS_H - 11}>{y === MAX_YEAR ? 'Now' : formatYearShort(y)}</text>
              </g>
            )
          })}
          <g transform={`translate(${t.applyX(yearX)},0)`} className="axis__now">
            <path d={`M-6,${AXIS_H - 8}L6,${AXIS_H - 8}L0,${AXIS_H}z`} />
          </g>
        </g>
      </svg>
      <p className="tree__hint">Scroll to pan · pinch or ctrl-scroll to zoom · tap the axis to set the year</p>
    </div>
  )
}

type ContentProps = {
  layout: Layout
  year: number
  word: WordId | null
  selectedId: string | null
  related: Set<string> | null
  onSelect: (id: string | null) => void
}

const TreeContent = memo(function TreeContent({
  layout,
  year,
  word,
  selectedId,
  related,
  onSelect,
}: ContentProps) {
  const selected = selectedId ? byId.get(selectedId) : undefined

  return (
    <>
      {layout.bands.map((b, i) => (
        <g key={b.group.id + i} className="band">
          <rect
            className={`band__fill${i % 2 ? ' is-alt' : ''}`}
            x={0}
            y={b.y0}
            width={CHART_W}
            height={b.y1 - b.y0}
          />
          <rect x={0} y={b.y0} width={4} height={b.y1 - b.y0} fill={b.group.color} />
          <text className="band__label" x={14} y={b.y0 + 15} fill={b.group.color}>
            {b.group.label}
          </text>
        </g>
      ))}

      {layout.connectors.map((c) => {
        const dim = related && !(related.has(c.child.lang.id) && related.has(c.parent.lang.id))
        const x1 = xOf(c.child.lang.start)
        return (
          <g key={c.child.lang.id} className={`conn${dim ? ' is-dim' : ''}`} stroke={c.child.group.color}>
            <path d={`M${c.x},${c.parent.y}V${c.child.y - 6}Q${c.x},${c.child.y} ${c.x + 6},${c.child.y}H${Math.max(c.x + 6, x1)}`} />
            {c.gap && (
              <line className="conn__gap" x1={c.x + 6} x2={x1} y1={c.child.y} y2={c.child.y} />
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
        const yr = hi >= lo ? (lo + hi) / 2 : selected.start
        const x = xOf(yr)
        const bulge = Math.min(260, Math.abs(to.y - from.y) * 0.35 + 40)
        return (
          <path
            key={`contact-${cid}`}
            className="contact-arc"
            d={`M${x},${from.y}C${x + bulge},${from.y} ${x + bulge},${to.y} ${x},${to.y}`}
          />
        )
      })}

      {layout.rows.map((r) => {
        const l = r.lang
        const x0 = xOf(l.start)
        const x1 = xOf(l.end ?? MAX_YEAR)
        const alive = isAlive(l, year)
        const isSel = l.id === selectedId
        const dim = related ? !related.has(l.id) : false
        const w = word ? wordFor(l.id, word) : undefined
        return (
          <g
            key={l.id}
            className={`row${alive ? ' is-alive' : ''}${isSel ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${l.proto ? ' is-proto' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(l.id)
            }}
          >
            <rect className="row__hit" x={x0 - 200} y={r.y - ROW_H / 2} width={x1 - x0 + 210} height={ROW_H} />
            {l.afterlife && l.end != null && (
              <line className="row__afterlife" x1={x1} x2={xOf(MAX_YEAR)} y1={r.y} y2={r.y} stroke={r.group.color} />
            )}
            <line className="row__bar" x1={x0} x2={x1} y1={r.y} y2={r.y} stroke={r.group.color} />
            <circle className="row__start" cx={x0} cy={r.y} r={4} fill={r.group.color} />
            {l.end != null && (
              <text className="row__dagger" x={x1 + 4} y={r.y + 4}>
                †
              </text>
            )}
            <text className="row__name" x={x0 - 9} y={r.y + 4}>
              {l.name}
            </text>
            {w && (
              <text className="row__word" x={x0 + 8} y={r.y - 5}>
                {w}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
})
