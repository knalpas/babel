import type { Language, View, WordId } from '../types'
import { byId, childrenOf, groupOf, influenced, isAlive, lineage } from '../data'
import { WORDS, hasWords, wordFor } from '../data/words'
import { formatYear } from '../lib/time'

type Props = {
  lang: Language
  year: number
  word: WordId | null
  view: View
  onPick: (id: string) => void
  onClose: () => void
  onShowIn: (v: View) => void
}

function status(l: Language): { label: string; tone: string } {
  if (l.proto) return { label: 'Reconstructed', tone: 'proto' }
  if (l.end == null) return { label: l.revived ? 'Revived' : 'Living', tone: 'living' }
  if (l.revived) return { label: 'Revived', tone: 'living' }
  if (l.afterlife) return { label: 'Classical', tone: 'classical' }
  return { label: 'Extinct', tone: 'extinct' }
}

function dates(l: Language): string {
  const firmStart = l.firm === 'start' || l.firm === 'both'
  const firmEnd = l.firm === 'end' || l.firm === 'both'
  const a = formatYear(l.start, !firmStart)
  if (l.end == null) return `${a} – today`
  return `${a} – ${formatYear(l.end, !firmEnd)}`
}

function speakers(m: number): string {
  if (m >= 1) return `≈ ${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')} million`
  const n = Math.round(m * 1000) * 1000
  return `≈ ${n.toLocaleString('en-GB')}`
}

function Chip({ l, onPick }: { l: Language; onPick: (id: string) => void }) {
  return (
    <button type="button" className="chip" onClick={() => onPick(l.id)}>
      <span className="dot" style={{ background: groupOf(l.id).color }} />
      {l.name}
    </button>
  )
}

export function DetailPanel({ lang, year, word, view, onPick, onClose, onShowIn }: Props) {
  const g = groupOf(lang.id)
  const line = lineage(lang.id).slice(0, -1)
  const kids = (childrenOf.get(lang.id) ?? []).slice().sort((a, b) => a.start - b.start)
  const contacts = (lang.contacts ?? []).map((id) => byId.get(id)).filter(Boolean) as Language[]
  const shaped = influenced.get(lang.id) ?? []
  const st = status(lang)
  const alive = isAlive(lang, year)

  return (
    <aside className="panel" aria-label={`${lang.name} details`}>
      <div className="panel__grip" aria-hidden="true" />
      <button type="button" className="panel__close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className="panel__eyebrow" style={{ color: g.color }}>
        {g.family === g.label ? g.family : `${g.family} · ${g.label}`}
      </div>
      <h2 className="panel__title">{lang.name}</h2>
      {lang.native && lang.native !== lang.name && <div className="panel__native">{lang.native}</div>}

      <div className="panel__facts">
        <span className={`pill pill--${st.tone}`}>{st.label}</span>
        <span className="panel__dates">{dates(lang)}</span>
      </div>
      {!alive && (
        <p className="panel__note">
          Not spoken in {formatYear(year)}.
        </p>
      )}

      <p className="panel__summary">{lang.summary}</p>
      {lang.afterlife && <p className="panel__afterlife">{lang.afterlife}</p>}

      <dl className="panel__meta">
        {lang.speakers != null && (
          <>
            <dt>Speakers</dt>
            <dd>{speakers(lang.speakers)}</dd>
          </>
        )}
        {lang.script && (
          <>
            <dt>Script</dt>
            <dd>{lang.script}</dd>
          </>
        )}
      </dl>

      {line.length > 0 && (
        <section className="panel__section">
          <h3>Descent</h3>
          <ol className="lineage">
            {line.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onPick(a.id)}>
                  {a.name}
                </button>
              </li>
            ))}
            <li className="is-self">{lang.name}</li>
          </ol>
        </section>
      )}

      {kids.length > 0 && (
        <section className="panel__section">
          <h3>Gave rise to</h3>
          <div className="chips">
            {kids.map((k) => (
              <Chip key={k.id} l={k} onPick={onPick} />
            ))}
          </div>
        </section>
      )}

      {contacts.length > 0 && (
        <section className="panel__section">
          <h3>Borrowed heavily from</h3>
          <div className="chips">
            {contacts.map((c) => (
              <Chip key={c.id} l={c} onPick={onPick} />
            ))}
          </div>
        </section>
      )}

      {shaped.length > 0 && (
        <section className="panel__section">
          <h3>Left its mark on</h3>
          <div className="chips">
            {shaped.map((c) => (
              <Chip key={c.id} l={c} onPick={onPick} />
            ))}
          </div>
        </section>
      )}

      {hasWords(lang.id) && (
        <section className="panel__section">
          <h3>Three words</h3>
          <table className="words">
            <tbody>
              {WORDS.map((w) => (
                <tr key={w.id} className={word === w.id ? 'is-on' : ''}>
                  <th>{w.label}</th>
                  <td>{wordFor(lang.id, w.id) ?? <span className="muted">—</span>}</td>
                  <td className="words__pie">{w.pie}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="panel__actions">
        <button type="button" className="btn" onClick={() => onShowIn(view === 'tree' ? 'map' : 'tree')}>
          {view === 'tree' ? 'Show on the globe' : 'Show in the tree'}
        </button>
        {lang.wikipedia && (
          <a className="btn btn--ghost" href={`https://en.wikipedia.org/wiki/${lang.wikipedia}`} target="_blank" rel="noreferrer">
            Wikipedia ↗
          </a>
        )}
      </div>
    </aside>
  )
}
