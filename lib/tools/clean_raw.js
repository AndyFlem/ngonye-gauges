import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


const input = `/mnt/c/Users/Andy Fleming/Western Power Company/WPC Working - Documents/TEC Technical/R.53 Sioma Bridge Gauge/WPC_LOGGERS/Autoimport/ZRA`

// For each file in the input directory
const files = fs.readdirSync(input)
for (const file of files) {
  // Get the file name
  const fileName = path.basename(file)

  // if the filename containst 'LAPTOP' then delete
  if (fileName.includes('LAPTOP')) {
    fs.unlinkSync(path.join(input, file))
  }

  // if the filename containst '(1)' then delete
  if (fileName.includes('(1)')) {
    fs.unlinkSync(path.join(input, file))
  }  
}