# Babel

A time-scaled family tree and globe of the world's languages: 248 languages across 6,500 years, from Proto-Indo-European on the steppe to the 130-odd still spoken today. A sibling of [Chronoglobe](https://knalpas.github.io/chronoglobe/), [Sceptre](https://knalpas.github.io/kings/) and [Atelier](https://knalpas.github.io/atelier/).

**Live:** https://knalpas.github.io/babel/ (after the first deploy)

## Features

- **Tree**: a phylogeny with time running left to right on Chronoglobe's non-linear scale, one band per family or branch. Each language is a limb that thickens with the number of languages descended from it and curves off its parent where it split. Living languages end in a leaf, extinct ones in a bare twig and †; reconstructed proto-languages are faint ghost limbs, and a dotted trail shows a liturgical or revived afterlife. It scrolls like a normal page and opens on the whole tree; fold any family by its header, and stretch time with a two-finger pinch, **+ / − / Fit** or ctrl/⌘-scroll (text never shrinks).
- **Globe**: every language spoken in the chosen year, with arcs joining it to its parent. Select one to trace its whole migration path from the root of its family.
- **Timeline**: scrub, step or play from 4500 BC to today. The curve shows how many languages in the dataset are on record at each moment.
- **Detail panel**: dates, status, speakers, script, descent, daughters, and contact links in both directions (Atelier's "inspired by" idea, applied to loanwords: English ← Old Norse, Anglo-Norman, Latin).
- **Trace a word**: *three*, *mother* and *night* across about 100 Indo-European languages, beside the reconstructed PIE form.
- Permalinks: `?year=800&lang=old-norse&view=map&word=night` (`?year=44bc` also works).

## Develop

```bash
npm install
npm run dev
```

## Deploy (GitHub Pages)

```bash
npm run deploy
```

Builds and pushes `dist/` to the `gh-pages` branch. Vite `base` is `/babel/`.

`npm run build:single` writes one self-contained HTML file to `dist-single/`, handy for sharing a preview without hosting.

## Test

```bash
npm run build && npx --yes puppeteer browsers install chrome && node tests/e2e.cjs dist/index.html
```

60 scripted checks covering search, selection, scrolling, folding, zoom and pinch, timeline, word tracing, globe, permalinks and phone layout.

## Data

- **Languages** are hand-curated in `src/data/indoEuropean.ts` and `src/data/otherFamilies.ts`. Each entry has a parent, start and end years (astronomical: 1 BC = 0, via the `BC()` helper), a rough centre of its speakers, and optional `contacts` for heavy borrowing.
- **Dates** for proto-languages are scholarly estimates with wide error bars; Indo-European follows the steppe hypothesis. Dates marked `firm` are documentary (first inscription, last speaker, reform) and display without "c.".
- **Simplifications**: where intermediate stages are unknown or disputed, a language hangs from its nearest well-established ancestor (Amharic and Tigrinya from Proto-Semitic, for example).
- **Speakers** are rounded, mostly first-language estimates.
- **Words** live in `src/data/words.ts`.
- **Land** outline is the same Natural Earth file Chronoglobe uses, rewound for d3-geo.
- Colour groups are defined in `src/data/index.ts`: Indo-European by branch, every other family as one group.

In development, `src/data/index.ts` warns in the console about missing parents or contacts, and about a child dated before its parent.
