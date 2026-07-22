import fs from 'fs'
import path from 'path'

// Undo the archiving done by process_raw.js: move every .mis file out of the
// processed/<YYYYMM>/ monthly folders back into the raw root, then remove the
// now-empty monthly folders. The generated CSVs in gauge_data are left untouched.

// --- Configuration (mirrors process_raw.js; overridable via env) ---------------------------
const DEFAULT_BASE = '/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/Ngonye_Automatic_Gauges'
const RAW_DIR = process.env.RAW_DIR || path.join(DEFAULT_BASE, 'raw')
const PROCESSED_DIR = process.env.PROCESSED_DIR || path.join(RAW_DIR, 'processed')

function main() {
  if (!fs.existsSync(PROCESSED_DIR)) {
    console.log('Nothing to reset: processed folder does not exist:', PROCESSED_DIR)
    return
  }

  const monthDirs = fs.readdirSync(PROCESSED_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  let moved = 0
  let skipped = 0

  for (const monthKey of monthDirs) {
    const monthDir = path.join(PROCESSED_DIR, monthKey)
    const files = fs.readdirSync(monthDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.mis'))
      .map((e) => e.name)

    for (const file of files) {
      const dest = path.join(RAW_DIR, file)
      if (fs.existsSync(dest)) {
        console.error('Skipping', file, '- already exists in raw folder')
        skipped++
        continue
      }
      fs.renameSync(path.join(monthDir, file), dest)
      moved++
    }

    // Remove the monthly folder if it's now empty.
    if (fs.readdirSync(monthDir).length === 0) fs.rmdirSync(monthDir)
  }

  console.log(`Done. moved=${moved}, skipped=${skipped}, months=${monthDirs.length}`)
}

main()
