import { useEffect, useMemo, useRef, useState } from 'react'
import { LANGUAGES, isAlive } from '../data'
import {
  AXIS_TICKS,
  MAX_YEAR,
  MIN_YEAR,
  clampYear,
  formatYear,
  formatYearShort,
  fractionToYear,
  stepAt,
  yearToFraction,
} from '../lib/time'

type Props = {
  year: number
  onChange: (y: number) => void
  aliveCount: number
}

const SAMPLES = 240
const H = 44

/** How many languages in the dataset are spoken at each point of the track. */
function useDensity() {
  return useMemo(() => {
    const pts: { f: number; n: number }[] = []
    let max = 1
    for (let i = 0; i <= SAMPLES; i++) {
      const f = i / SAMPLES
      const y = fractionToYear(f)
      const n = LANGUAGES.filter((l) => isAlive(l, y)).length
      max = Math.max(max, n)
      pts.push({ f, n })
    }
    return { pts, max }
  }, [])
}

export function Timeline({ year, onChange, aliveCount }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const yearRef = useRef(year)
  yearRef.current = year
  const density = useDensity()

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const y = yearRef.current
      if (y >= MAX_YEAR) {
        setPlaying(false)
        return
      }
      onChange(clampYear(y + stepAt(y)))
    }, 70)
    return () => window.clearInterval(id)
  }, [playing, onChange])

  function setFromClientX(clientX: number) {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onChange(clampYear(fractionToYear((clientX - r.left) / r.width)))
  }

  function nudge(dir: number, big: boolean) {
    const s = stepAt(year) * (big ? 10 : 1)
    onChange(clampYear(year + dir * s))
  }

  const areaPath = useMemo(() => {
    const { pts, max } = density
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.f * 1000).toFixed(1)},${(H - (p.n / max) * (H - 4)).toFixed(1)}`)
    return `${d.join('')}L1000,${H}L0,${H}Z`
  }, [density])

  const f = yearToFraction(year)

  return (
    <footer className="timeline">
      <div className="timeline__readout">
        <button
          type="button"
          className="play"
          onClick={() => {
            if (!playing && year >= MAX_YEAR) onChange(MIN_YEAR)
            setPlaying((p) => !p)
          }}
          aria-label={playing ? 'Pause' : 'Play through time'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6a.6.6 0 0 0 .9.5l9.4-5.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5z" /></svg>
          )}
        </button>
        <div className="timeline__year">{formatYear(year)}</div>
        <div className="timeline__count">
          <strong>{aliveCount}</strong> {aliveCount === 1 ? 'language' : 'languages'} in the record
        </div>
        <div className="timeline__steps">
          <button type="button" onClick={() => nudge(-1, false)} aria-label="Earlier">‹</button>
          <button type="button" onClick={() => nudge(1, false)} aria-label="Later">›</button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="timeline__track"
        role="slider"
        tabIndex={0}
        aria-label="Year"
        aria-valuemin={MIN_YEAR}
        aria-valuemax={MAX_YEAR}
        aria-valuenow={year}
        aria-valuetext={formatYear(year)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setPlaying(false)
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromClientX(e.clientX)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') nudge(-1, e.shiftKey)
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') nudge(1, e.shiftKey)
          else if (e.key === 'Home') onChange(MIN_YEAR)
          else if (e.key === 'End') onChange(MAX_YEAR)
          else if (e.key === ' ') setPlaying((p) => !p)
          else return
          e.preventDefault()
        }}
      >
        <svg className="timeline__density" viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={areaPath} />
        </svg>
        <div className="timeline__ticks" aria-hidden="true">
          {AXIS_TICKS.filter((y) => y !== MIN_YEAR).map((y) => (
            <span
              key={y}
              className={`tick${y === 1 || y === 1000 || y === 1500 || y === 2000 ? ' is-major' : ''}`}
              style={{ left: `${yearToFraction(y) * 100}%` }}
            >
              {y === 1 ? 'AD 1' : formatYearShort(y)}
            </span>
          ))}
        </div>
        <div className="timeline__handle" style={{ left: `${f * 100}%` }} aria-hidden="true" />
      </div>
    </footer>
  )
}
