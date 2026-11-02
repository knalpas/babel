import { useEffect, useMemo, useRef, useState } from 'react'
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import type { FeatureCollection } from 'geojson'
import type { Language, WordId } from '../types'
import { GROUPS, LANGUAGES, byId, groupOf, isAlive, lineage } from '../data'
import { wordFor } from '../data/words'
import { formatYear } from '../lib/time'
import landJson from '../data/land.json'

const land = landJson as unknown as FeatureCollection
const graticule = geoGraticule10()
const SPHERE = { type: 'Sphere' } as const

type Props = {
  panelOpen: boolean
  year: number
  word: WordId | null
  selectedId: string | null
  focusSeq: number
  onSelect: (id: string | null) => void
}

type Placed = { x: number; y: number; w: number; h: number }

function overlaps(a: Placed, b: Placed): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function priority(l: Language, selectedLine: Set<string>): number {
  if (selectedLine.has(l.id)) return 1e9
  if (l.speakers != null) return l.speakers
  // Ancient and proto languages have no speaker count; rank them as notable.
  return l.end != null ? 40 : 1
}

export function MapView({ panelOpen, year, word, selectedId, focusSeq, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [rot, setRot] = useState<[number, number]>([-35, -38])
  const [k, setK] = useState(1)
  const rotRef = useRef(rot)
  rotRef.current = rot
  const prevT = useRef<ZoomTransform>(zoomIdentity)
  const anim = useRef<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isPhone = size.w < 760
  const baseR = Math.min(size.w, size.h) / 2 - (isPhone ? 14 : 34)
  const radius = baseR * k
  // Keep the globe's centre in the part of the stage the detail panel leaves free.
  const cx = panelOpen && !isPhone ? (size.w - 400) / 2 : size.w / 2
  const cy = panelOpen && isPhone ? size.h * 0.19 : size.h / 2

  // Drag rotates the globe; wheel / pinch zooms.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.85, 9])
      .on('start', () => {
        if (anim.current) cancelAnimationFrame(anim.current)
      })
      .on('zoom', (e) => {
        const t: ZoomTransform = e.transform
        const p = prevT.current
        prevT.current = t
        setK(t.k)
        if (t.k === p.k) {
          const r = baseR * t.k
          const deg = 180 / Math.PI
          const [l0, p0] = rotRef.current
          setRot([l0 + ((t.x - p.x) / r) * deg, Math.max(-80, Math.min(80, p0 - ((t.y - p.y) / r) * deg))])
        }
      })
    const sel = select(svg)
    sel.call(z).on('dblclick.zoom', null)
    return () => {
      sel.on('.zoom', null)
    }
  }, [baseR])

  // Spin to the selected language.
  useEffect(() => {
    if (!focusSeq || !selectedId) return
    const l = byId.get(selectedId)
    if (!l) return
    const [l0, p0] = rotRef.current
    let target = -l.lon
    while (target - l0 > 180) target -= 360
    while (target - l0 < -180) target += 360
    const t1 = -Math.max(-70, Math.min(70, l.lat))
    const start = performance.now()
    const dur = 750
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / dur)
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      setRot([l0 + (target - l0) * e, p0 + (t1 - p0) * e])
      if (u < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current)
    }
  }, [focusSeq, selectedId])

  const projection = useMemo(
    () =>
      geoOrthographic()
        .rotate([rot[0], rot[1]])
        .scale(radius)
        .translate([cx, cy])
        .clipAngle(90),
    [rot, radius, cx, cy],
  )
  const path = useMemo(() => geoPath(projection), [projection])
  const center: [number, number] = [-rot[0], -rot[1]]

  const alive = useMemo(() => LANGUAGES.filter((l) => isAlive(l, year)), [year])
  const line = useMemo(() => (selectedId ? lineage(selectedId) : []), [selectedId])
  const lineIds = useMemo(() => new Set(line.map((l) => l.id)), [line])

  const visible = (l: Language) => geoDistance([l.lon, l.lat], center) < Math.PI / 2 - 0.02

  // Greedy label placement, most important first.
  const labels = useMemo(() => {
    const candidates = [...alive, ...line.filter((l) => !isAlive(l, year))]
      .filter((l, i, a) => a.indexOf(l) === i)
      .filter(visible)
      .sort((a, b) => priority(b, lineIds) - priority(a, lineIds))
    const placed: Placed[] = []
    const out: { l: Language; x: number; y: number; text: string; isWord: boolean }[] = []
    for (const l of candidates) {
      const p = projection([l.lon, l.lat])
      if (!p) continue
      const w0 = word ? wordFor(l.id, word) : undefined
      const text = w0 ?? l.name
      const box = { x: p[0] + 7, y: p[1] - 8, w: text.length * 6.4 + 4, h: 15 }
      if (placed.some((b) => overlaps(b, box))) continue
      placed.push(box, { x: p[0] - 5, y: p[1] - 5, w: 10, h: 10 })
      out.push({ l, x: p[0] + 8, y: p[1] + 4, text, isWord: !!w0 })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alive, line, lineIds, projection, word, year])

  const groupsNow = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of alive) {
      const g = groupOf(l.id)
      counts.set(g.id, (counts.get(g.id) ?? 0) + 1)
    }
    return GROUPS.filter((g) => counts.has(g.id)).map((g) => ({ g, n: counts.get(g.id)! }))
  }, [alive])

  const lineagePath =
    line.length > 1
      ? path({ type: 'LineString', coordinates: line.map((l) => [l.lon, l.lat]) })
      : null

  return (
    <div ref={wrapRef} className="map">
      <svg
        ref={svgRef}
        className="map__svg"
        width={size.w}
        height={size.h}
        role="img"
        aria-label={`Globe of languages spoken in ${formatYear(year)}`}
        onClick={() => onSelect(null)}
      >
        <defs>
          <radialGradient id="globe-shade" cx="38%" cy="32%" r="75%">
            <stop offset="0%" className="shade-a" />
            <stop offset="100%" className="shade-b" />
          </radialGradient>
        </defs>
        <path className="map__ocean" d={path(SPHERE) ?? ''} />
        <path className="map__graticule" d={path(graticule) ?? ''} />
        <path className="map__land" d={path(land) ?? ''} />
        <path className="map__shade" d={path(SPHERE) ?? ''} fill="url(#globe-shade)" />

        <g className="map__arcs">
          {alive.map((l) => {
            const p = l.parentId ? byId.get(l.parentId) : undefined
            if (!p) return null
            const d = path({ type: 'LineString', coordinates: [[p.lon, p.lat], [l.lon, l.lat]] })
            if (!d) return null
            const dim = selectedId && !lineIds.has(l.id)
            return <path key={l.id} d={d} stroke={groupOf(l.id).color} className={dim ? 'is-dim' : ''} />
          })}
        </g>

        {lineagePath && <path className="map__lineage" d={lineagePath} />}

        {line
          .filter((l) => !isAlive(l, year) && visible(l))
          .map((l) => {
            const p = projection([l.lon, l.lat])
            if (!p) return null
            return (
              <circle
                key={`anc-${l.id}`}
                className="map__ancestor"
                cx={p[0]}
                cy={p[1]}
                r={4}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(l.id)
                }}
              />
            )
          })}

        <g className="map__dots">
          {alive.filter(visible).map((l) => {
            const p = projection([l.lon, l.lat])
            if (!p) return null
            const isSel = l.id === selectedId
            const dim = selectedId && !lineIds.has(l.id)
            return (
              <g
                key={l.id}
                transform={`translate(${p[0]},${p[1]})`}
                className={`dot${isSel ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${l.proto ? ' is-proto' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(l.id)
                }}
              >
                <circle className="dot__hit" r={12} />
                {isSel && <circle className="dot__halo" r={11} />}
                <circle className="dot__core" r={isSel ? 6 : 4.5} fill={groupOf(l.id).color} />
                <title>{l.name}</title>
              </g>
            )
          })}
        </g>

        <g className="map__labels">
          {labels.map(({ l, x, y, text, isWord }) => (
            <text
              key={l.id}
              x={x}
              y={y}
              className={`label${isWord ? ' is-word' : ''}${l.id === selectedId ? ' is-selected' : ''}${!isAlive(l, year) ? ' is-ancestor' : ''}${selectedId && !lineIds.has(l.id) ? ' is-dim' : ''}`}
            >
              {text}
            </text>
          ))}
        </g>
      </svg>

      <details className="map__legend" aria-label="Families on the map" open={!isPhone}>
        <summary className="map__legend-title">Spoken in {formatYear(year)}</summary>
        <ul>
          {groupsNow.map(({ g, n }) => (
            <li key={g.id}>
              <span className="dot" style={{ background: g.color }} />
              {g.label}
              <span className="map__legend-n">{n}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="map__hint">Drag to turn · pinch or scroll to zoom · arcs join each language to its parent</p>
    </div>
  )
}
