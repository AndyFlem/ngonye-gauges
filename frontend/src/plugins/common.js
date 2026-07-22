import * as d3 from 'd3'
import {schemeCategory10} from 'd3-scale-chromatic'

export default {
  install: (app) => {

    app.provide('colors', {
      wind: d3.quantize(d3.interpolateHcl(" #1e8449", " #49b3a6"), 12),
      solar: d3.quantize(d3.interpolateHcl(" #e39b00", " #cede30"), 12),
      combined: d3.quantize(d3.interpolateHcl(" #922b21", " #797d7f"), 12),
      storage: d3.quantize(d3.interpolateHcl(" #16a085", " #aed6f1"), 12),
      demand: d3.quantize(d3.interpolateHcl(" #55587c", " #8e6aa8"), 12),
      hydro: d3.quantize(d3.interpolateHcl(" #2874a6", " #76d7c4"), 12),
    })

    app.provide('font',(smAndUp)=>{
      console.log('smAndUp',smAndUp)
        return {
        family: 'Courier New, monospace',
        size: smAndUp.value?13:11,
        color: '#6f6f6f'
      }
    })

    app.provide('makeTrans', (col,opacity) => {
      let c=d3.color(col)
      c.opacity=opacity
      return c.formatRgb()
    })

    app.provide('months',
      ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    )
  }
}
