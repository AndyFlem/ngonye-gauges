import * as d3 from 'd3'

export const ZONE = 'CAT' // Central Africa Time (UTC+2, no DST) — Zambia

export function isValidValue(str) {
  // Numeric AND > 0. Rejects blanks, non-numbers, 0 and negatives (sensor faults).
  if (typeof str !== 'string') return false
  const trimmed = str.trim()
  if (trimmed === '' || isNaN(trimmed) || isNaN(parseFloat(trimmed))) return false
  return parseFloat(trimmed) > 0
}

export const fmt = d3.format('.3f')
