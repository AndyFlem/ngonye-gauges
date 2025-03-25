import fs from 'fs'
import path from 'path'



const input = `/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/R.53 Sioma Bridge Gauge/WPC_LOGGERS/Autoimport`

// For each file in the input directory
const files = fs.readdirSync(input) // get all files in the input directory
for (const file of files) {
  // Get the file name
  const fileName = path.basename(file)

  // if the filename containst 'WPC' then move to the WPC subfolder
  if (fileName.includes('WPC')) {
      fs.renameSync(path.join(input, file), path.join(input, 'WPC', file))
  }
  // if the filename containst 'ZRA' then move to the ZRA subfolder
  if (fileName.includes('ZRA')) {
    fs.renameSync(path.join(input, file), path.join(input, 'ZRA', file))
  } 
}
