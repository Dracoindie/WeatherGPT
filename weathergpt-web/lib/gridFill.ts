/**
 * Balanced panel grids with no holes.
 *
 * Panels on the Living Sky home appear conditionally (GFS, climate, advisory,
 * air quality), so fixed col-span classes leave gaps. fillRows() lays the
 * panels out row by row for a given column count and widens the last panel
 * of any row that would end short, so every row is full.
 */

export interface Slot {
  key: string
  /** Preferred width in columns (clamped to the column count). */
  span: number
}

export function fillRows(slots: Slot[], cols: number): number[] {
  const spans = slots.map((s) => Math.max(1, Math.min(cols, s.span)))
  // Spread a short row's leftover columns over its panels, last first.
  const close = (row: number[], used: number) => {
    let left = cols - used
    for (let k = row.length - 1; left > 0; k = (k - 1 + row.length) % row.length) {
      spans[row[k]] += 1
      left -= 1
    }
  }
  let row: number[] = []
  let used = 0
  for (let i = 0; i < spans.length; i++) {
    if (used + spans[i] > cols) {
      close(row, used)
      row = []
      used = 0
    }
    row.push(i)
    used += spans[i]
    if (used === cols) {
      row = []
      used = 0
    }
  }
  if (row.length) close(row, used)
  return spans
}

// Literal class names so Tailwind generates them.
const SM: Record<number, string> = { 1: 'sm:col-span-1', 2: 'sm:col-span-2' }
const XL: Record<number, string> = { 1: 'xl:col-span-1', 2: 'xl:col-span-2', 3: 'xl:col-span-3', 4: 'xl:col-span-4' }

/** Grid: 1 column on phones, 2 from sm, 4 from xl. Returns a class per slot. */
export function panelSpanClasses(slots: Slot[]): string[] {
  const sm = fillRows(slots, 2)
  const xl = fillRows(slots, 4)
  return slots.map((_, i) => `${SM[sm[i]]} ${XL[xl[i]]}`)
}

export const PANEL_GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4'
