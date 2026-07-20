import fs from 'fs'
import path from 'path'
import { DateTime } from 'luxon'
import * as d3 from 'd3'
import { ZONE, isValidValue, fmt } from './gauge_common.js'

// --- Configuration (overridable via env for testing) ---------------------------------------
//const DEFAULT_BASE = '/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/Ngonye_Automatic_Gauges'
if (!process.env.RAW_DIR || !process.env.OUT_DIR) {
  console.error('Please set RAW_DIR and OUT_DIR environment variables before running.')
  process.exit(1)
} else {
  console.log('RAW_DIR =', process.env.RAW_DIR)
  console.log('OUT_DIR =', process.env.OUT_DIR)
}``
const RAW_DIR = process.env.RAW_DIR //|| path.join(DEFAULT_BASE, 'raw')
const OUT_DIR = process.env.OUT_DIR //|| path.join(DEFAULT_BASE, 'gauge_data')
const MONTHLY_DIR = path.join(OUT_DIR, 'monthly') // 15-min monthly CSVs
const PROCESSED_DIR = path.join(OUT_DIR, 'processed')

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

// fs.renameSync fails with EXDEV when src/dest are on different filesystems (e.g. an
// FTP mount vs. the data disk), so fall back to copy+delete in that case.
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    fs.copyFileSync(src, dest)
    fs.unlinkSync(src)
  }
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

  // 3. Archive processed input files.
  console.log(`Archiving ${toArchive.length} processed raw file(s) into ${PROCESSED_DIR}...`)
  for (const { file, monthKey } of toArchive) {
    const destDir = path.join(PROCESSED_DIR, monthKey)
    fs.mkdirSync(destDir, { recursive: true })
    moveFile(path.join(RAW_DIR, file), path.join(destDir, file))
  }

  // 4. Summary.
  console.log(
    `Done. files=${stats.files} (empty=${stats.empty}, unreadable=${stats.unreadable}), ` +
    `valid readings=${stats.valid}, rejected=${stats.rejected}, ` +
    `months written=${readings.size}, rows updated=${rowsTouched}, ` +
    `archived=${toArchive.length}`
  )
}

// Derive YYYYMM from the filename timestamp, e.g. SiomaBridgeZRA__20260713080030.mis -> 202607.
// Falls back to the current month if the filename has no recognisable timestamp.
function monthKeyFromName(name) {
  const m = name.match(/(\d{4})(\d{2})\d{8}\.mis$/)
  if (m) return m[1] + m[2]
  return DateTime.now().setZone(ZONE).toFormat('yyyyMM')
}

main()
