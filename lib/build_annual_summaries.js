import fs from 'fs'
import path from 'path'
import { DateTime } from 'luxon'
import * as d3 from 'd3'
import { ZONE, isValidValue, fmt } from './gauge_common.js'

// --- Configuration (overridable via env for testing) ---------------------------------------
if (!process.env.OUT_DIR) {
  console.error('Please set OUT_DIR environment variable before running.')
  process.exit(1)
} else {
  console.log('OUT_DIR =', process.env.OUT_DIR)
}
const OUT_DIR = process.env.OUT_DIR
const MONTHLY_DIR = path.join(OUT_DIR, 'monthly') // 15-min monthly CSVs
const ANNUAL_DIR = path.join(OUT_DIR, 'annual') // daily-summary water-year CSVs

const ISO_DATE = 'yyyy-MM-dd'
const NO_DATA = 'no data'

// Water year runs 1 Oct -> 30 Sep. Return { start, end } calendar years for a given date.
function waterYear(dt) {
  return dt.month >= 10
    ? { start: dt.year, end: dt.year + 1 }
    : { start: dt.year - 1, end: dt.year }
}

// Read every monthly CSV, aggregate the per-interval `average` into daily max/min/mean,
// then write one water-year file per WY with a contiguous row per complete day (gaps and
// trailing days up to yesterday filled with the 'no data' placeholder). Returns file count.
function buildAnnualSummaries() {
  console.log('Rebuilding annual water-year summaries...')
  const monthFiles = fs.readdirSync(MONTHLY_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /^SiomaBridge_\d{6}\.csv$/.test(e.name))
    .map((e) => e.name)
  console.log(`  Aggregating ${monthFiles.length} monthly CSV(s)`)

  // isoDate -> array of valid interval-average floats for that day
  const dayValues = new Map()
  for (const name of monthFiles) {
    const rows = d3.csvParse(fs.readFileSync(path.join(MONTHLY_DIR, name), 'utf8'))
    for (const r of rows) {
      if (!isValidValue(String(r.average))) continue
      const date = String(r.datetime).slice(0, 10) // 'yyyy-MM-dd' prefix of the ISO datetime
      if (!dayValues.has(date)) dayValues.set(date, [])
      dayValues.get(date).push(parseFloat(r.average))
    }
  }

  // isoDate -> { max, min, average } (formatted strings); grouped into water years.
  const byWaterYear = new Map() // 'start-end' -> { start, end, days: Map<isoDate, summary> }
  for (const [date, values] of dayValues) {
    const dt = DateTime.fromISO(date, { zone: ZONE })
    const wy = waterYear(dt)
    const key = `${wy.start}-${wy.end}`
    if (!byWaterYear.has(key)) byWaterYear.set(key, { start: wy.start, end: wy.end, days: new Map() })
    byWaterYear.get(key).days.set(date, {
      max: fmt(d3.max(values)),
      min: fmt(d3.min(values)),
      average: fmt(d3.mean(values)),
    })
  }

  const yesterday = DateTime.now().setZone(ZONE).minus({ days: 1 }).startOf('day')

  let written = 0
  for (const { start, end, days } of byWaterYear.values()) {
    // First day with data anchors the top of the file (avoids leading pre-gauge 'no data').
    const dates = [...days.keys()].sort()
    let cursor = DateTime.fromISO(dates[0], { zone: ZONE })
    // End at the earlier of yesterday and the water year's final day (30 Sep of end year).
    const wyEnd = DateTime.fromObject({ year: end, month: 9, day: 30 }, { zone: ZONE })
    const endDate = yesterday < wyEnd ? yesterday : wyEnd
    if (endDate < cursor) continue // only incomplete/future days so far — nothing to write

    // Water year starts 1 Oct: water_month counts Oct=1..Sep=12, water_week counts 7-day
    // blocks from 1 Oct (=1) regardless of calendar-year boundaries.
    const wyStart = DateTime.fromObject({ year: start, month: 10, day: 1 }, { zone: ZONE })

    const out = []
    while (cursor <= endDate) {
      const date = cursor.toFormat(ISO_DATE)
      const s = days.get(date)
      const waterMonth = cursor.month >= 10 ? cursor.month - 9 : cursor.month + 3
      const waterWeek = Math.floor(cursor.diff(wyStart, 'days').days / 7) + 1
      out.push({
        date,
        year: cursor.year,
        month: cursor.month,
        day: cursor.day,
        water_year: start,
        water_month: waterMonth,
        water_week: waterWeek,
        level_max: s ? s.max : NO_DATA,
        level_min: s ? s.min : NO_DATA,
        level_average: s ? s.average : NO_DATA,
      })
      cursor = cursor.plus({ days: 1 })
    }

    const file = path.join(ANNUAL_DIR, `SiomaBridge_WY${start}-${end}.csv`)
    console.log(`  [WY${start}-${end}] ${out.length} day(s) through ${endDate.toFormat(ISO_DATE)} -> ${path.basename(file)}`)
    fs.writeFileSync(file, d3.csvFormat(out, [
      'date', 'year', 'month', 'day', 'water_year', 'water_month', 'water_week',
      'level_max', 'level_min', 'level_average',
    ]) + '\n')
    written++
  }

  return written
}

// --- Main ----------------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(MONTHLY_DIR)) {
    console.error('Monthly folder does not exist:', MONTHLY_DIR)
    process.exit(1)
  }
  fs.mkdirSync(ANNUAL_DIR, { recursive: true })

  const annualFiles = buildAnnualSummaries()

  console.log(`Done. annual files=${annualFiles}`)
}

main()
