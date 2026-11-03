import { useEffect } from 'react'
import { LANGUAGES } from '../data'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const living = LANGUAGES.filter((l) => l.end == null).length

  return (
    <div className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={onClose}>
      <div className="about__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="about-title">How to read Babel</h2>
        <p>
          {LANGUAGES.length} languages across 6,500 years, {living} of them still spoken. Each limb in the tree is
          one language’s lifetime, branching from its parent where it became distinct; the more languages descend
          from it, the thicker it grows. A whole family hangs from one trunk: Proto-Indo-European runs down the
          left and all ten of its branches, from Anatolian to Balto-Slavic, grow out of it. Living languages end in
          leaves (two from 10 million speakers, three from 100 million). Extinct ones end in a dry twig and †, and
          revived ones grow a new bud. Faint limbs are reconstructed proto-languages that were never written down.
        </p>
        <p>
          On the globe, each dot is a language spoken in the chosen year, placed at the rough centre of its
          speakers, and each arc joins it to its parent. Select a language to trace its whole ancestry across the map.
        </p>
        <h3>About the dates</h3>
        <ul>
          <li>
            Dates of proto-languages are scholarly estimates with error bars of centuries. Indo-European follows the
            steppe hypothesis.
          </li>
          <li>Start dates mark when a language became distinct or was first written, whichever the record allows.</li>
          <li>Dates without “c.” are documentary: a first inscription, a last speaker, a reform.</li>
          <li>
            Speaker figures are rounded, mostly first-language estimates. Several family trees are simplified: where
            intermediate stages are unknown or disputed, a language hangs from its nearest well-established ancestor.
          </li>
        </ul>
        <h3>Links</h3>
        <p>
          Add <code>?year=800&amp;lang=old-norse&amp;view=map</code> to the address to open a specific moment.
          A sibling of <a href="https://knalpas.github.io/chronoglobe/" target="_blank" rel="noreferrer">Chronoglobe</a>,{' '}
          <a href="https://knalpas.github.io/kings/" target="_blank" rel="noreferrer">Sceptre</a> and{' '}
          <a href="https://knalpas.github.io/atelier/" target="_blank" rel="noreferrer">Atelier</a>.
        </p>
      </div>
    </div>
  )
}
