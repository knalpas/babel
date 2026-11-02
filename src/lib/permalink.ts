import type { View, WordId } from '../types'
import { byId } from '../data'
import { BC, clampYear } from './time'

export type UrlState = {
  year: number
  view: View
  lang: string | null
  word: WordId | null
}

const WORD_IDS: WordId[] = ['three', 'mother', 'night']

/** Accepts `?year=1066`, `?year=44bc`, `?lang=old-norse`, `?view=map`, `?word=night`. */
export function readUrl(fallbackYear: number): UrlState {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    params = new URLSearchParams()
  }
  const rawYear = params.get('year')
  let year = fallbackYear
  if (rawYear) {
    const m = /^(-?\d+)\s*(bc)?$/i.exec(rawYear.trim())
    if (m) year = clampYear(m[2] ? BC(Number(m[1])) : Number(m[1]))
  }
  const lang = params.get('lang')
  const word = params.get('word') as WordId | null
  return {
    year,
    view: params.get('view') === 'map' ? 'map' : 'tree',
    lang: lang && byId.has(lang) ? lang : null,
    word: word && WORD_IDS.includes(word) ? word : null,
  }
}

export function writeUrl(s: UrlState): void {
  try {
    const p = new URLSearchParams()
    p.set('year', s.year <= 0 ? `${1 - s.year}bc` : String(s.year))
    if (s.view === 'map') p.set('view', 'map')
    if (s.lang) p.set('lang', s.lang)
    if (s.word) p.set('word', s.word)
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
  } catch {
    // Sandboxed frames may refuse history writes; the app works without them.
  }
}
