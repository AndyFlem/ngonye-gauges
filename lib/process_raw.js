import fs from 'fs'
import path from 'path'
import { DateTime } from 'luxon'
import * as d3 from 'd3'

const baseFolder='/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/Ngonye_Automatic_Gauges/'
const rawFlolder = baseFolder + '/Raw'
// For each file in the raw folder
const files = fs.readdirSync(rawFlolder)
for (const file of files) {
  // If the file has a .mis extension
  if (file.includes('.mis') && (file.includes('ZRA') || file.includes('WPC'))) {

    console.log('Processing file:', file)
    // Open the file
    let data = ''
    const sections = []

    try {
      data = fs.readFileSync(path.join(rawFlolder, file), 'utf8')
      // read the file line by line
      const lines = data.split('\n')
      lines.forEach((line) => {
        // If the line starts with a <STATION> then it is a section header
        if (line.startsWith('<STATION>')) {
          sections.push({ sensor: getSensor(line), lines: [] })
        } else {
          // Otherwise add the line to the last section
          sections[sections.length - 1].lines.push(line)
        }
      })
      
      if (sections.length > 0 && sections[0].lines.length > 0) {
        // Get the date of the first line        
        const fileDate = processLine(sections[0].lines[0]).dateTime
        
        // Search for an existing file or create if it doesnt exist
        const monthName = fileDate.year + d3.format('02d')(fileDate.month)
        const monthFileName = baseFolder + '/Output/SiomaBridge_' + monthName + '.csv'
        if (!fs.existsSync(monthFileName)) {
          fs.writeFileSync(monthFileName,'')
        }
        const month = d3.csvParse(fs.readFileSync(monthFileName, 'utf-8')).map(v=> {
          v.date = DateTime.fromISO(v.dateTime)
          return v
        })

        sections.forEach((section) => {
          section.lines.forEach(line => {
            const lineDetail = processLine(line)
            if (lineDetail) {
              if (month.find(d => d.dateTime == lineDetail.dateTime.toISO())) {

                const existingLine = month.find(d => d.dateTime == lineDetail.dateTime.toISO())
                existingLine[section.sensor] = lineDetail.value
              } else {
                month.push({date: lineDetail.dateTime, dateTime: lineDetail.dateTime.toISO(), [section.sensor]: lineDetail.value})
              }
            }
          })
        })
        month.sort((a,b) => a.date - b.date)
        month.forEach(d => { delete d.date })
        fs.writeFileSync(monthFileName, d3.csvFormat(month))

        const processedFolder = path.join(rawFlolder, 'Processed', monthName)
        if (!fs.existsSync(processedFolder)) {
          fs.mkdirSync(processedFolder)
        }
        // Move the input file to the processed folder
        fs.renameSync(path.join(rawFlolder, file), path.join(processedFolder, file))
      }

    } catch (err) {
      console.error(err)
      continue
    }
  }
}

function processLine(line) {
  const parts = line.split(';')

  if (parts.length == 3) {    
    const dateParts = parts[0].split('/')
    const time = parts[1]
    const rawValue = parts[2]
    if (!isNumeric(rawValue)) {
      return null
    }
    const value = parseFloat(rawValue)
    const dateTime = DateTime.fromObject({
      year: parseInt(dateParts[0]),
      month: parseInt(dateParts[1]),
      day: parseInt(dateParts[2]),
      hour: parseInt(time.substring(0, 2)),
      minute: parseInt(time.substring(2, 4)),
      second: parseInt(time.substring(4, 6))
    }, {zone: 'CAT'})
    return {dateTime, value}
  } else {
    return null
  }
}

function getSensor(header)  {
  // Set the string between the <SENSOR> tags as the sensor name
  const start = header.indexOf('<SENSOR>') + 8
  const end = header.indexOf('</SENSOR>')
  const rawSensor = header.substring(start, end)

  switch(rawSensor) {
    case '00WL':
      return 'WPC_Level'
    case '0WWL':
      return 'WPC_Level'
    case '0ZWL':
      return 'ZRA_Level'
    case 'WL_S':
      return 'WPC_Status'      
    case '0WST':
      return 'WPC_Status'
    case '0BAT':
      return 'WPC_Battery'
    case '0ZST':
      return 'ZRA_Status'
    default:
      return rawSensor
  } 
}

function isNumeric(str) {
  if (typeof str != "string") return false // we only process strings!  
  return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
         !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}