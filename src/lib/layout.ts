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
  /** Section of the family this branch belongs to (Indo-European for Celtic). */
  familyId: string
  /** Languages in the whole family, for a family's own header. */
  familyCount: number
  /** This section is a branch of a bigger family. */
  isBranch: boolean
}

/** A branch of a family, joined to the family's trunk. */
export type Offshoot = {
  /** The family root's row (e.g. Proto-Indo-European). */
  trunk: Row
  /** The branch root's row, or null when that branch is folded. */
  child: Row | null
  /** Where the branch arrives: its root's bar, or its folded header. */
  y: number
  start: number
  sectionId: string
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
  offshoots: Offshoot[]
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

/** Family root for every section: the topmost ancestor's section. */
const FAMILY_OF = new Map<string, string>()
const FAMILY_COUNT = new Map<string, number>()
for (const s of ORDER) {
  let l: Language | undefined = s.langs[0]
  while (l?.parentId) l = byId.get(l.parentId)
  const fam = l ? groupOf(l.id).id : s.group.id
  FAMILY_OF.set(s.group.id, fam)
  FAMILY_COUNT.set(fam, (FAMILY_COUNT.get(fam) ?? 0) + s.langs.length)
}

/** Sections that belong to a family: the family's own and all its branches. */
export function familySections(familyId: string): string[] {
  return ORDER.filter((s) => FAMILY_OF.get(s.group.id) === familyId).map((s) => s.group.id)
}

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
    const familyId = FAMILY_OF.get(s.group.id) ?? s.group.id
    sections.push({
      group: s.group,
      y0,
      y1: y,
      count: s.langs.length,
      collapsed: isCollapsed,
      from,
      familyId,
      familyCount: FAMILY_COUNT.get(familyId) ?? s.langs.length,
      isBranch: familyId !== s.group.id,
    })
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

  const offshoots: Offshoot[] = []
  for (const sec of sections) {
    if (!sec.isBranch) continue
    const trunk = rowById.get(sec.familyId)
    if (!trunk) continue
    const child = rowById.get(sec.group.id) ?? null
    const root = byId.get(sec.group.id)!
    offshoots.push({
      trunk,
      child,
      y: child ? child.y : sec.y0 + HEADER_H / 2,
      start: root.start,
      sectionId: sec.group.id,
    })
  }

  return { rows, rowById, sections, connectors, offshoots, height: y + 60 }
}

export function sectionOf(id: string): string {
  return groupOf(id).id
}
