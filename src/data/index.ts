import type { Group, Language } from '../types'
import { indoEuropean } from './indoEuropean'
import { otherFamilies } from './otherFamilies'

/**
 * Colour groups. Indo-European is split into its ten branches (keyed by the
 * branch's proto-language); every other family is one group keyed by its root.
 * Hues are mid-lightness so they read on both the parchment and night themes.
 */
export const GROUPS: Group[] = [
  { id: 'pie', label: 'Indo-European', family: 'Indo-European', color: '#b08d57' },
  { id: 'proto-anatolian', label: 'Anatolian', family: 'Indo-European', color: '#a8714a' },
  { id: 'proto-tocharian', label: 'Tocharian', family: 'Indo-European', color: '#9a7b9e' },
  { id: 'proto-greek', label: 'Hellenic', family: 'Indo-European', color: '#4f86b8' },
  { id: 'proto-armenian', label: 'Armenian', family: 'Indo-European', color: '#c2604f' },
  { id: 'proto-albanian', label: 'Albanian', family: 'Indo-European', color: '#b04a5e' },
  { id: 'proto-indo-iranian', label: 'Indo-Iranian', family: 'Indo-European', color: '#d08a2e' },
  { id: 'proto-italic', label: 'Italic', family: 'Indo-European', color: '#b9504a' },
  { id: 'proto-celtic', label: 'Celtic', family: 'Indo-European', color: '#3f9a6a' },
  { id: 'proto-germanic', label: 'Germanic', family: 'Indo-European', color: '#5a74c4' },
  { id: 'proto-balto-slavic', label: 'Balto-Slavic', family: 'Indo-European', color: '#8a62b8' },
  { id: 'proto-uralic', label: 'Uralic', family: 'Uralic', color: '#3d9aa3' },
  { id: 'proto-turkic', label: 'Turkic', family: 'Turkic', color: '#c47a3c' },
  { id: 'proto-semitic', label: 'Semitic', family: 'Afroasiatic', color: '#9c8a3a' },
  { id: 'egyptian', label: 'Egyptian', family: 'Afroasiatic', color: '#c49a3a' },
  { id: 'proto-sino-tibetan', label: 'Sino-Tibetan', family: 'Sino-Tibetan', color: '#c4504f' },
  { id: 'proto-austronesian', label: 'Austronesian', family: 'Austronesian', color: '#2f9c8c' },
  { id: 'proto-bantu', label: 'Bantu', family: 'Niger–Congo', color: '#7d9a3a' },
  { id: 'proto-dravidian', label: 'Dravidian', family: 'Dravidian', color: '#c46a8a' },
  { id: 'proto-japonic', label: 'Japonic', family: 'Japonic', color: '#d06a6a' },
  { id: 'old-korean', label: 'Koreanic', family: 'Koreanic', color: '#5f8fb0' },
  { id: 'proto-mayan', label: 'Mayan', family: 'Mayan', color: '#4f9a54' },
  { id: 'nahuatl', label: 'Uto-Aztecan', family: 'Uto-Aztecan', color: '#a8873a' },
  { id: 'proto-quechua', label: 'Quechuan', family: 'Quechuan', color: '#8f7a5a' },
  { id: 'sumerian', label: 'Sumerian (isolate)', family: 'Isolate', color: '#8a8478' },
  { id: 'elamite', label: 'Elamite (isolate)', family: 'Isolate', color: '#7f8a84' },
  { id: 'proto-hurro-urartian', label: 'Hurro-Urartian', family: 'Hurro-Urartian', color: '#94806a' },
  { id: 'etruscan', label: 'Etruscan', family: 'Tyrsenian', color: '#9a6a5a' },
  { id: 'aquitanian', label: 'Basque (Vasconic)', family: 'Vasconic', color: '#6a8a6a' },
]

export const LANGUAGES: Language[] = [...indoEuropean, ...otherFamilies]

export const byId = new Map(LANGUAGES.map((l) => [l.id, l]))
const groupIds = new Set(GROUPS.map((g) => g.id))
export const groupById = new Map(GROUPS.map((g) => [g.id, g]))

export const childrenOf = new Map<string, Language[]>()
for (const l of LANGUAGES) {
  if (!l.parentId) continue
  const list = childrenOf.get(l.parentId) ?? []
  list.push(l)
  childrenOf.set(l.parentId, list)
}

/** Ancestors from the root down to (and including) the language. */
export function lineage(id: string): Language[] {
  const out: Language[] = []
  let cur = byId.get(id)
  while (cur) {
    out.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

const groupCache = new Map<string, Group>()
/** Nearest ancestor (or self) that names a colour group. */
export function groupOf(id: string): Group {
  const hit = groupCache.get(id)
  if (hit) return hit
  const line = lineage(id)
  let g: Group | undefined
  for (let i = line.length - 1; i >= 0; i--) {
    if (groupIds.has(line[i].id)) {
      g = groupById.get(line[i].id)
      break
    }
  }
  const out = g ?? GROUPS[0]
  groupCache.set(id, out)
  return out
}

/** Languages whose vocabulary this one shaped (reverse of `contacts`). */
export const influenced = new Map<string, Language[]>()
for (const l of LANGUAGES) {
  for (const c of l.contacts ?? []) {
    const list = influenced.get(c) ?? []
    list.push(l)
    influenced.set(c, list)
  }
}

export function isAlive(l: Language, year: number): boolean {
  return l.start <= year && (l.end == null || year <= l.end)
}

if (import.meta.env.DEV) {
  for (const l of LANGUAGES) {
    if (l.parentId && !byId.has(l.parentId)) console.warn('Missing parent', l.id, l.parentId)
    for (const c of l.contacts ?? []) if (!byId.has(c)) console.warn('Missing contact', l.id, c)
    const p = l.parentId ? byId.get(l.parentId) : null
    if (p && l.start < p.start) console.warn('Child older than parent', l.id)
  }
}
