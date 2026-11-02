import type { Group, Language } from '../types'
import { GROUPS, LANGUAGES, byId, childrenOf, groupOf } from '../data'
import { MAX_YEAR, yearToFraction } from './time'

/**
 * Phylogeny layout. Time runs left → right on Chronoglobe's non-linear scale,
 * stretched to `trackW` pixels (zooming changes only this, so text never
 * shrinks). Every language gets its own row, parent above its descendants.
 * Siblings are ordered latest-first, so a connector always sits left of the
 * rows it passes and never crosses a bar.
 */

export const ROW_H = 30
export const HEADER_H = 38
export const PAD_L = 28
export const PAD_R = 90
/** Bar sits a little below the row centre; the name sits above it. */
export const BAR_DY = 5

export function makeX(trackW: number) {
  return (year: number) => PAD_L + yearToFraction(year) * trackW
}

export type Row = {
  lang: Language
  /** y of the bar. */
  y: number
  group: Group
}

export type Section = {
  group: Group
  /** Top of the header strip. */
  y0: number
  /** Bottom of the section (header + rows). */
  y1: number
  count: number
  collapsed: boolean
  /** The language this branch split from, in another section. */
  from?: Language
}

export type Connector = {
  parent: Row
  child: Row
  /** Year where the child branches off its parent. */
  at: number
  /** The record is silent between the parent's end and the child's start. */
  gap: boolean
}

export type Layout = {
  rows: Row[]
  rowById: Map<string, Row>
  sections: Section[]
  connectors: Connector[]
  height: number
}

/**
 * Sections follow the GROUPS order (Indo-European branches in their usual
 * sequence, then the other families). Inside a section, languages are in
 * depth-first order from the section's own root. Branch roots connect to
 * their parent in another section by name, not by a line across the chart.
 */
function order(): { group: Group; langs: Language[] }[] {
  const out: { group: Group; langs: Language[] }[] = []
  for (const group of GROUPS) {
    const root = LANGUAGES.find((l) => l.id === group.id)
    if (!root) continue
    const langs: Language[] = []
    const visit = (l: Language) => {
      langs.push(l)
      const kids = (childrenOf.get(l.id) ?? [])
        .filter((k) => groupOf(k.id).id === group.id)
        .sort((a, b) => b.start - a.start)
      for (const k of kids) visit(k)
    }
    visit(root)
    out.push({ group, langs })
  }
  return out
}

const ORDER = order()

export function buildLayout(collapsed: Set<string>): Layout {
  const rows: Row[] = []
  const sections: Section[] = []
  let y = 0
  for (const s of ORDER) {
    const isCollapsed = collapsed.has(s.group.id)
    const y0 = y
    y += HEADER_H
    if (!isCollapsed) {
      y += 4
      for (const l of s.langs) {
        rows.push({ lang: l, y: y + ROW_H / 2 + BAR_DY, group: s.group })
        y += ROW_H
      }
      y += 10
    }
    const pid = s.langs[0].parentId
    const from = pid ? byId.get(pid) : undefined
    sections.push({ group: s.group, y0, y1: y, count: s.langs.length, collapsed: isCollapsed, from })
  }

  const rowById = new Map(rows.map((r) => [r.lang.id, r]))
  const connectors: Connector[] = []
  for (const row of rows) {
    const pid = row.lang.parentId
    const parent = pid ? rowById.get(pid) : undefined
    if (!parent || parent.group.id !== row.group.id) continue
    const pEnd = parent.lang.end ?? MAX_YEAR
    const at = Math.min(Math.max(row.lang.start, parent.lang.start), pEnd)
    connectors.push({ parent, child: row, at, gap: row.lang.start > pEnd })
  }

  return { rows, rowById, sections, connectors, height: y + 60 }
}

export function sectionOf(id: string): string {
  return groupOf(id).id
}
