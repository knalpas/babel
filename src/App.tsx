import { useCallback, useEffect, useMemo, useState } from 'react'
import type { View, WordId } from './types'
import { LANGUAGES, byId, isAlive } from './data'
import { readUrl, writeUrl } from './lib/permalink'
import { Header } from './components/Header'
import { TreeView } from './components/TreeView'
import { MapView } from './components/MapView'
import { Timeline } from './components/Timeline'
import { DetailPanel } from './components/DetailPanel'
import { AboutDialog } from './components/AboutDialog'

const DEFAULT_YEAR = 1000

export default function App() {
  const initial = useMemo(() => readUrl(DEFAULT_YEAR), [])
  const [view, setView] = useState<View>(initial.view)
  const [year, setYear] = useState(initial.year)
  const [selectedId, setSelectedId] = useState<string | null>(initial.lang)
  const [word, setWord] = useState<WordId | null>(initial.word)
  const [focusSeq, setFocusSeq] = useState(initial.lang ? 1 : 0)
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    writeUrl({ year, view, lang: selectedId, word })
  }, [year, view, selectedId, word])

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null
  const aliveCount = useMemo(() => LANGUAGES.filter((l) => isAlive(l, year)).length, [year])

  /** Select and fly to a language; jump the year into its lifetime if needed. */
  const pick = useCallback(
    (id: string) => {
      const l = byId.get(id)
      if (!l) return
      setSelectedId(id)
      setFocusSeq((n) => n + 1)
      if (!isAlive(l, year)) {
        const end = l.end ?? year
        setYear(Math.round(l.start + (Math.min(end, 2026) - l.start) * 0.5))
      }
    },
    [year],
  )

  return (
    <div className={`app app--${view}${selected ? ' has-panel' : ''}`}>
      <Header
        view={view}
        onView={setView}
        word={word}
        onWord={setWord}
        onPick={pick}
        onAbout={() => setAboutOpen(true)}
      />

      <main className="stage">
        {view === 'tree' ? (
          <TreeView
            year={year}
            word={word}
            selectedId={selectedId}
            focusSeq={focusSeq}
            onSelect={setSelectedId}
            onYear={setYear}
          />
        ) : (
          <MapView
            panelOpen={!!selected}
            year={year}
            word={word}
            selectedId={selectedId}
            focusSeq={focusSeq}
            onSelect={setSelectedId}
          />
        )}

        {selected && (
          <DetailPanel
            lang={selected}
            year={year}
            word={word}
            view={view}
            onPick={pick}
            onClose={() => setSelectedId(null)}
            onShowIn={(v) => {
              setView(v)
              setFocusSeq((n) => n + 1)
            }}
          />
        )}
      </main>

      <Timeline year={year} onChange={setYear} aliveCount={aliveCount} />

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
