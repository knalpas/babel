import type { Group, Language } from '../types'
import { GROUPS, LANGUAGES, childrenOf, groupOf } from '../data'
import { MAX_YEAR, yearToFraction } from './time'

/**
 * Phylogeny layout. Time runs left → right on Chronoglobe's non-linear scale;
 * every language gets its own row, written in depth-first order with the
 * parent above its descendants. Siblings are ordered latest-first, which
 * guarantees that no branch connector ever crosses another language's bar.
 */

export const ROW_H = 26
export const TRACK_W = 2400
export const PAD_L = 230
export const PAD_R = 60
export const PAD_T = 46
export const GROUP_GAP = 18

export const CHART_W = PAD_L + TRACK_W + PAD_R

export function xOf(year: number): number {
  return PAD_L + yearToFraction(year) * TRACK_W
}

export type Row = {
  lang: Language
  y: number
  depth: number
  group: Group
}

export type Band = {
  group: Group
  y0: number
  y1: number
}

export type Connector = {
  parent: Row
  child: Row
  /** x where the child branches off its parent's bar. */
  x: number
  /** Gap where the record is silent between parent's end and child's start. */
  gap: boolean
}

export type Layout = {
  rows: Row[]
  rowById: Map<string, Row>
  bands: Band[]
  connectors: Connector[]
  height: number
}

function groupRank(l: Language): number {
  const g = groupOf(l.id)
  const i = GROUPS.findIndex((x) => x.id === g.id)
  return i < 0 ? GROUPS.length : i
}

export function buildLayout(): Layout {
  const roots = LANGUAGES.filter((l) => l.parentId == null).sort(
    (a, b) => groupRank(a) - groupRank(b) || a.start - b.start,
  )

  const rows: Row[] = []
  const bands: Band[] = []
  let y = PAD_T
  let currentBand: Band | null = null

  function visit(l: Language, depth: number) {
    const group = groupOf(l.id)
    if (!currentBand || currentBand.group.id !== group.id) {
      if (currentBand) {
        currentBand.y1 = y
        y += GROUP_GAP
      }
      currentBand = { group, y0: y, y1: y }
      bands.push(currentBand)
    }
    rows.push({ lang: l, y: y + ROW_H / 2, depth, group })
    y += ROW_H
    const kids = (childrenOf.get(l.id) ?? []).slice()
    // Latest-first keeps connectors from crossing bars. Branch groups sort
    // after same-family leaves so a branch band stays contiguous.
    kids.sort((a, b) => b.start - a.start)
    const plain = kids.filter((k) => groupOf(k.id).id === group.id)
    const branches = kids.filter((k) => groupOf(k.id).id !== group.id)
    for (const k of plain) visit(k, depth + 1)
    for (const k of branches) visit(k, depth + 1)
  }

  for (const r of roots) visit(r, 0)
  if (currentBand) (currentBand as Band).y1 = y

  const rowById = new Map(rows.map((r) => [r.lang.id, r]))
  const connectors: Connector[] = []
  for (const row of rows) {
    const pid = row.lang.parentId
    if (!pid) continue
    const parent = rowById.get(pid)
    if (!parent) continue
    const pEnd = parent.lang.end ?? MAX_YEAR
    const at = Math.min(Math.max(row.lang.start, parent.lang.start), pEnd)
    connectors.push({ parent, child: row, x: xOf(at), gap: row.lang.start > pEnd })
  }

  return { rows, rowById, bands, connectors, height: y + 40 }
}
