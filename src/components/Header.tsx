import { useMemo, useRef, useState } from 'react'
import type { View, WordId } from '../types'
import { LANGUAGES, groupOf } from '../data'
import { WORDS } from '../data/words'
import { formatYear } from '../lib/time'

type Props = {
  view: View
  onView: (v: View) => void
  word: WordId | null
  onWord: (w: WordId | null) => void
  onPick: (id: string) => void
  onAbout: () => void
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function Header({ view, onView, word, onWord, onPick, onAbout }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__name">Babel</span>
        <span className="brand__tag">The family tree of languages</span>
      </div>
      <div className="header__controls">
        <div className="seg" role="tablist" aria-label="View">
          {(['tree', 'map'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`seg__btn${view === v ? ' is-on' : ''}`}
              onClick={() => onView(v)}
            >
              {v === 'tree' ? 'Tree' : 'Map'}
            </button>
          ))}
        </div>
        <label className="word-pick">
          <span className="word-pick__label">Trace a word</span>
          <select
            id="word-select"
            value={word ?? ''}
            onChange={(e) => onWord((e.target.value || null) as WordId | null)}
          >
            <option value="">None</option>
            {WORDS.map((w) => (
              <option key={w.id} value={w.id}>
                “{w.label}”
              </option>
            ))}
          </select>
        </label>
        <SearchBox onPick={onPick} />
        <button type="button" className="icon-btn" onClick={onAbout} aria-label="About the data">
          ?
        </button>
      </div>
    </header>
  )
}

function SearchBox({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const f = fold(q.trim())
    if (!f) return []
    return LANGUAGES.filter(
      (l) => fold(l.name).includes(f) || (l.native && fold(l.native).includes(f)),
    )
      .sort((a, b) => Number(!fold(a.name).startsWith(f)) - Number(!fold(b.name).startsWith(f)))
      .slice(0, 8)
  }, [q])

  function choose(id: string) {
    onPick(id)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        id="language-search"
        type="search"
        placeholder="Search languages"
        aria-label="Find a language"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(results.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && results[active]) {
            choose(results[active].id)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="search__results" role="listbox">
          {results.map((l, i) => (
            <li key={l.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'is-active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(l.id)}
              >
                <span className="dot" style={{ background: groupOf(l.id).color }} />
                <span className="search__name">{l.name}</span>
                <span className="search__meta">
                  {formatYear(l.start, true)}
                  {l.end == null ? '' : ` – ${formatYear(l.end)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
