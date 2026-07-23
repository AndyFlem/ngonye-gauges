<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { csvParse, autoType } from 'd3-dsv'
import PlotlyChart from '@/components/PlotlyChart.vue'

const ANNUAL_URL = 'https://data.westernpower.org/gauge-data/annual/'

// One entry per file; `rows` holds that CSV's contents as an array of row objects.
const annualFiles = ref([])
const loading = ref(true)
const error = ref(null)

// const colors = inject('colors')
const font = inject('font')
// const months = inject('months')
// const makeTrans = inject('makeTrans')

async function loadAll() {
  loading.value = true
  error.value = null
  try {
    const files = await listFiles(ANNUAL_URL)
    // Fetch and parse every CSV in parallel; each element's `rows` is that file's contents.
    annualFiles.value = await Promise.all(
      files.map(async (file) => {
        const rows = await fetchCsv(file.url)
        return { ...file, rows }
      }),
    )
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function listFiles(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const html = await res.text()

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows = Array.from(doc.querySelectorAll('table tr'))

  return rows
    .map((row) => {
      const link = row.querySelector('a[href$=".csv"]')
      if (!link) return null
      const cells = row.querySelectorAll('td')
      return {
        name: link.getAttribute('href'),
        url: new URL(link.getAttribute('href'), ANNUAL_URL).href,
        lastModified: cells[2]?.textContent.trim() ?? '',
        size: cells[3]?.textContent.trim() ?? '',
      }
    })
    .filter(Boolean)
}

async function fetchCsv(url) {
  const res = await fetch(`${url}?t=${Date.now()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  return csvParse(text, autoType)
}

// Day number within the water year: 1st October = 1, running to 30th September.
function waterDay(date) {
  const y = date.getUTCFullYear()
  const startYear = date.getUTCMonth() >= 9 ? y : y - 1 // Oct–Dec belong to that year's water year
  const start = Date.UTC(startYear, 9, 1) // 1st October
  return Math.round((date.getTime() - start) / 86400000) + 1
}

function chartAnnualEnergy() {
  const latest = latestAnnualFile.value.rows

  // Water-year start (calendar year of the 1st October), taken from the data.
  const sample = latest.find((v) => v.date instanceof Date)?.date
  const startYear = sample ? (sample.getUTCMonth() >= 9 ? sample.getUTCFullYear() : sample.getUTCFullYear() - 1) : 2000

  // Month-start ticks labelled Oct → Sep, positioned by their water-day value.
  const months = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]
  const monthLabels = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
  const tickvals = months.map((m, i) => waterDay(new Date(Date.UTC(startYear + (i < 3 ? 0 : 1), m, 1))))

  var data = annualFiles.value.map(a=> {
    console.log(a)
    return   {
      x: a.rows.map((v) => waterDay(v.date)),
      y: a.rows.map((v) => v.level_average),
      text: a.rows.map((v) => formatDate(v.date)),
      name: a.name,
      hoverinfo: 'text+y'
    }
  })

  var layout = {
    height: 320,
    showlegend: true,
    legend: { xanchor: 'left', x: 0, y: -0.2, orientation: 'h' },
    margin: { l: 70, r: 5, b: 30, t: 10 },
    font: font,
    xaxis: {
      showgrid: false,
      zeroline: false,
      ticks: 'outside',
      tickmode: 'array',
      tickvals: tickvals,
      ticktext: monthLabels,
      range: [1, 366]
    },
    yaxis: {
      title: '',
      showgrid: true,
      zeroline: false,
      tickformat: '.1f',
      ticks: 'outside',
      
    }
  }
  return { data, layout, config: { displayModeBar: false } }
}

// The dataset for the latest water year (highest year in the filename).
const latestAnnualFile = computed(() => {
  let best = null
  for (const file of annualFiles.value) {
    if (!best || annualFileYear(file.name) > annualFileYear(best.name)) best = file
  }
  return best
})

// The latest record: last positive reading in the latest annual CSV only.
const latestRecord = computed(() => {
    if (!latestAnnualFile.value) return null
    const rows = latestAnnualFile.value.rows
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].level_average > 0) return rows[i]
    }
  }
)

// True when the latest record's date is more than 2 days old.
const latestIsStale = computed(() => {
  const date = latestRecord.value?.date
  if (!(date instanceof Date)) return false
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000
  return Date.now() - date.getTime() > twoDaysMs
})

function formatDate(value) {
  if (!(value instanceof Date)) return value

  const day = value.getDate()
  const year = value.getFullYear()

  // ordinal (1st, 2nd, 3rd, 4th... with 11-13 -> th)
  const ord = (n => {
    const rem100 = n % 100
    if (rem100 >= 11 && rem100 <= 13) return 'th'
    switch (n % 10) {
      case 1:
        return 'st'
      case 2:
        return 'nd'
      case 3:
        return 'rd'
      default:
        return 'th'
    }
  })(day)

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(value)
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(value)

  return `${weekday} ${day}${ord} ${month} ${year}`
}

// Sort key from the (water) year in a filename, e.g. "SiomaBridge_WY2024-2025.csv" -> 2025.
function annualFileYear(name) {
  const years = name.match(/\d{4}/g)
  return years ? Math.max(...years.map(Number)) : -Infinity
}

onMounted(loadAll)
</script>

<template>
  <main>
    <h1>Sioma Bridge Automatic Gauges</h1>

    <p v-if="loading">Loading…</p>

    <p v-else-if="error" class="error">
      Failed to load annualFiles: {{ error }}
      <button @click="loadAll">Retry</button>
    </p>

    <p v-else-if="annualFiles.length === 0">No CSV annualFiles found.</p>

    <template v-else>
      <section v-if="latestRecord" class="latest" :class="latestIsStale ? 'stale' : 'fresh'">
        <h2>{{ formatDate(latestRecord.date) }}</h2>
        <p class="reading">{{ latestRecord.level_average }} m</p>
        <p class="meta">
          {{ latestRecord.gauges_min }} gauges recording
        </p>
      </section>
      <PlotlyChart :definition="chartAnnualEnergy()" />
    </template>
  </main>
</template>

<style scoped>
main {
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
  font-family: system-ui, sans-serif;
}

.latest {
  margin-bottom: 2rem;
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #f7f9fb;
}

.latest.fresh {
  background: #e6f4ea;
  border-color: #b7dfc2;
}

.latest.stale {
  background: #fce8e6;
  border-color: #f2b8b5;
}

.latest h2 {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #556;
}

.latest .reading {
  margin: 0;
  font-size: 2.25rem;
  font-weight: 700;
}

.latest .meta {
  margin: 0.25rem 0 0;
  color: #667;
}

.error {
  color: #b00020;
}

button {
  margin-left: 0.5rem;
}
</style>
