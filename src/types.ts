/** Years are astronomical integers (1 BC = 0, 2 BC = −1), as in Chronoglobe. */
export type Year = number

export type Language = {
  id: string
  name: string
  /** Endonym in its own script, for living languages. */
  native?: string
  /** Parent in this dataset. Null for the root of a family. */
  parentId: string | null
  /** When the language becomes distinct (or is first attested). */
  start: Year
  /** Last native speakers. Null means still spoken today. */
  end: Year | null
  /** Which dates are documentary rather than estimated. */
  firm?: 'start' | 'end' | 'both'
  /** Reconstructed by comparison, never written down. */
  proto?: boolean
  /** Life after native speakers: liturgy, scholarship, revival. */
  afterlife?: string
  revived?: boolean
  /** Rough centre of its speakers, for the globe. */
  lat: number
  lon: number
  /** Approximate speakers today, in millions. */
  speakers?: number
  script?: string
  summary: string
  /** Languages that left a heavy mark on its vocabulary. */
  contacts?: string[]
  wikipedia?: string
}

export type Group = {
  id: string
  label: string
  family: string
  /** Hue used for bars, dots and arcs. */
  color: string
}

export type View = 'tree' | 'map'
export type WordId = 'three' | 'mother' | 'night'
