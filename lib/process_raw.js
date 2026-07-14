import fs from 'fs'
import path from 'path'
import { DateTime } from 'luxon'
import * as d3 from 'd3'

// --- Configuration (overridable via env for testing) ---------------------------------------
//const DEFAULT_BASE = '/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/Ngonye_Automatic_Gauges'
if (!process.env.RAW_DIR || !process.env.OUT_DIR) {
  console.error('Please set RAW_DIR and OUT_DIR environment variables before running.')
  process.exit(1)
} else {
  console.log('RAW_DIR =', process.env.RAW_DIR)
  console.log('OUT_DIR =', process.env.OUT_DIR)
}
const RAW_DIR = process.env.RAW_DIR //|| path.join(DEFAULT_BASE, 'raw')
const OUT_DIR = process.env.OUT_DIR //|| path.join(DEFAULT_BASE, 'gauge_data')
const MONTHLY_DIR = path.join(OUT_DIR, 'monthly') // 15-min monthly CSVs
const ANNUAL_DIR = path.join(OUT_DIR, 'annual') // daily-summary water-year CSVs
const PROCESSED_DIR = process.env.PROCESSED_DIR || path.join(RAW_DIR, 'processed') // lowercase: matches sync_raw.sh --exclude=processed/

const ZONE = 'CAT' // Central Africa Time (UTC+2, no DST) — Zambia
const COLUMNS = ['datetime', 'ZRA', 'WPC', 'count', 'average']
const DT_FORMAT = "yyyy-MM-dd'T'HH:mm" // ISO 8601 local, fixed-width, lexicographically sortable
const INTERVAL_MIN = 15

// Water-level sensor id -> output column. Everything else (status/battery) is ignored.
const SENSOR_COLUMN = {
  '0ZWL': 'ZRA',
  '0WWL': 'WPC',
  '00WL': 'WPC',
}

// --- Helpers -------------------------------------------------------------------------------

function isValidValue(str) {
  // Numeric AND > 0. Rejects blanks, non-numbers, 0 and negatives (sensor faults).
  if (typeof str !== 'string') return false
  const trimmed = str.trim()
  if (trimmed === '' || isNaN(trimmed) || isNaN(parseFloat(trimmed))) return false
  return parseFloat(trimmed) > 0
}

function getSensor(headerLine) {
  const start = headerLine.indexOf('<SENSOR>')
  const end = headerLine.indexOf('</SENSOR>')
  if (start === -1 || end === -1) return null
  return headerLine.substring(start + '<SENSOR>'.length, end)
}

// Parse a data row "YYYY/MM/DD;hhmmss;value" -> { dt, value } or null if malformed/invalid.
function parseLine(line) {
  const parts = line.split(';')
  if (parts.length !== 3) return null
  const [rawDate, rawTime, rawValue] = parts
  if (!isValidValue(rawValue)) return null

  const dateParts = rawDate.split('/')
  if (dateParts.length !== 3) return null
  if (rawTime.trim().length < 6) return null

  const dt = DateTime.fromObject({
    year: parseInt(dateParts[0], 10),
    month: parseInt(dateParts[1], 10),
    day: parseInt(dateParts[2], 10),
    hour: parseInt(rawTime.substring(0, 2), 10),
    minute: parseInt(rawTime.substring(2, 4), 10),
    second: parseInt(rawTime.substring(4, 6), 10),
  }, { zone: ZONE })

  if (!dt.isValid) return null
  return { dt, value: parseFloat(rawValue.trim()) }
}

const monthFilePath = (monthKey) => path.join(MONTHLY_DIR, `SiomaBridge_${monthKey}.csv`)

// Build every 15-min interval row for a calendar month, initialised blank.
function buildMonthGrid(monthKey) {
  const year = parseInt(monthKey.substring(0, 4), 10)
  const month = parseInt(monthKey.substring(4, 6), 10)
  let cursor = DateTime.fromObject({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, { zone: ZONE })
  const monthEnd = cursor.endOf('month')

  const rows = new Map() // datetimeStr -> row object
  while (cursor <= monthEnd) {
    const key = cursor.toFormat(DT_FORMAT)
    rows.set(key, { datetime: key, ZRA: '', WPC: '', count: '', average: '' })
    cursor = cursor.plus({ minutes: INTERVAL_MIN })
  }
  return rows
}

const fmt = d3.format('.3f')

function recomputeRow(row) {
  const values = []
  if (isValidValue(String(row.ZRA))) values.push(parseFloat(row.ZRA))
  if (isValidValue(String(row.WPC))) values.push(parseFloat(row.WPC))
  row.count = values.length
  row.average = values.length ? fmt(d3.mean(values)) : ''
}

// --- Main ----------------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error('Raw folder does not exist:', RAW_DIR)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(MONTHLY_DIR, { recursive: true })
  fs.mkdirSync(ANNUAL_DIR, { recursive: true })
  fs.mkdirSync(PROCESSED_DIR, { recursive: true })

  // 1. Collect candidate files from the raw root (processed/ is a subfolder, so excluded).
  const entries = fs.readdirSync(RAW_DIR, { withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.mis') && (e.name.includes('ZRA') || e.name.includes('WPC')))
    .map((e) => e.name)

  console.log(`Found ${files.length} raw .mis file(s) in ${RAW_DIR}`)

  // readings: monthKey -> (datetimeStr -> { ZRA?, WPC? })
  const readings = new Map()
  const toArchive = [] // { file, monthKey }
  const stats = { files: 0, empty: 0, unreadable: 0, valid: 0, rejected: 0 }

  for (const file of files) {
    const full = path.join(RAW_DIR, file)
    stats.files++
    console.log(`  [${stats.files}/${files.length}] reading ${file}`)

    let data
    try {
      data = fs.readFileSync(full, 'utf8')
    } catch (err) {
      console.error('Could not read', file, '-', err.message)
      stats.unreadable++
      continue // leave it in place for a later run
    }

    if (data.trim() === '') {
      stats.empty++
      toArchive.push({ file, monthKey: monthKeyFromName(file) })
      continue
    }

    let currentColumn = null // set when inside a level section; null while skipping others
    for (const rawLine of data.split('\n')) {
      const line = rawLine.trim()
      if (line === '') continue

      if (line.startsWith('<STATION>')) {
        const sensor = getSensor(line)
        currentColumn = SENSOR_COLUMN[sensor] || null
        continue
      }
      if (!currentColumn) continue // inside an ignored (status/battery) section

      const parsed = parseLine(line)
      if (!parsed) { stats.rejected++; continue }

      const monthKey = parsed.dt.toFormat('yyyyMM')
      const dtStr = parsed.dt.toFormat(DT_FORMAT)
      if (!readings.has(monthKey)) readings.set(monthKey, new Map())
      const monthReadings = readings.get(monthKey)
      if (!monthReadings.has(dtStr)) monthReadings.set(dtStr, {})
      monthReadings.get(dtStr)[currentColumn] = parsed.value
      stats.valid++
    }

    toArchive.push({ file, monthKey: monthKeyFromName(file) })
  }

  // 2. Merge into monthly CSVs (one write per affected month).
  console.log(`Merging ${readings.size} month(s) into monthly CSVs...`)
  let rowsTouched = 0
  for (const [monthKey, monthReadings] of readings) {
    const grid = buildMonthGrid(monthKey)
    const file = monthFilePath(monthKey)
    console.log(`  [month ${monthKey}] ${monthReadings.size} interval(s) from this run -> ${path.basename(file)}`)

    // Overlay any existing CSV so prior runs' data / manual edits are preserved.
    if (fs.existsSync(file)) {
      const existing = d3.csvParse(fs.readFileSync(file, 'utf8'))
      for (const r of existing) {
        const row = grid.get(r.datetime)
        if (!row) continue // outside the canonical grid (e.g. stale row) — drop it
        if (r.ZRA !== undefined && r.ZRA !== '') row.ZRA = r.ZRA
        if (r.WPC !== undefined && r.WPC !== '') row.WPC = r.WPC
      }
    }

    // Overlay this run's new readings.
    for (const [dtStr, cells] of monthReadings) {
      const row = grid.get(dtStr)
      if (!row) continue // defensive: reading outside the month grid
      if (cells.ZRA !== undefined) row.ZRA = fmt(cells.ZRA)
      if (cells.WPC !== undefined) row.WPC = fmt(cells.WPC)
      rowsTouched++
    }

    const rows = [...grid.values()]
    for (const row of rows) recomputeRow(row)
    rows.sort((a, b) => (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0))

    fs.writeFileSync(file, d3.csvFormat(rows, COLUMNS) + '\n')
  }

  // 3. Rebuild annual water-year daily summaries from the monthly CSVs.
  const annualFiles = buildAnnualSummaries()

  // 4. Archive processed input files.
  for (const { file, monthKey } of toArchive) {
    const destDir = path.join(PROCESSED_DIR, monthKey)
    fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(path.join(RAW_DIR, file), path.join(destDir, file))
  }

  // 5. Summary.
  console.log(
    `Done. files=${stats.files} (empty=${stats.empty}, unreadable=${stats.unreadable}), ` +
    `valid readings=${stats.valid}, rejected=${stats.rejected}, ` +
    `months written=${readings.size}, rows updated=${rowsTouched}, ` +
    `annual files=${annualFiles}, archived=${toArchive.length}`
  )
}

// --- Annual water-year summaries -----------------------------------------------------------

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

    const out = []
    while (cursor <= endDate) {
      const date = cursor.toFormat(ISO_DATE)
      const s = days.get(date)
      out.push(s
        ? { date, max: s.max, min: s.min, average: s.average }
        : { date, max: NO_DATA, min: NO_DATA, average: NO_DATA })
      cursor = cursor.plus({ days: 1 })
    }

    const file = path.join(ANNUAL_DIR, `SiomaBridge_WY${start}-${end}.csv`)
    console.log(`  [WY${start}-${end}] ${out.length} day(s) through ${endDate.toFormat(ISO_DATE)} -> ${path.basename(file)}`)
    fs.writeFileSync(file, d3.csvFormat(out, ['date', 'max', 'min', 'average']) + '\n')
    written++
  }

  return written
}

// Derive YYYYMM from the filename timestamp, e.g. SiomaBridgeZRA__20260713080030.mis -> 202607.
// Falls back to the current month if the filename has no recognisable timestamp.
function monthKeyFromName(name) {
  const m = name.match(/(\d{4})(\d{2})\d{8}\.mis$/)
  if (m) return m[1] + m[2]
  return DateTime.now().setZone(ZONE).toFormat('yyyyMM')
}

main()
