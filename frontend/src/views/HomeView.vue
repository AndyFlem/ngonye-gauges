<script setup>
import { ref, computed, onMounted } from 'vue'
import { csvParse, autoType } from 'd3-dsv'

const BASE_URL = 'https://data.westernpower.org/gauge-data/annual/'

const annual = ref([])
// One entry per file; `rows` holds that CSV's contents as an array of row objects.
const datasets = ref([])
const loading = ref(true)
const error = ref(null)

async function listFiles() {
  const res = await fetch(BASE_URL)
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
        url: new URL(link.getAttribute('href'), BASE_URL).href,
        lastModified: cells[2]?.textContent.trim() ?? '',
        size: cells[3]?.textContent.trim() ?? '',
      }
    })
    .filter(Boolean)
}

async function fetchCsv(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  return csvParse(text, autoType)
}

async function loadAll() {
  loading.value = true
  error.value = null
  try {
    annual.value = await listFiles()
    // Fetch and parse every CSV in parallel; each element's `rows` is that file's contents.
    datasets.value = await Promise.all(
      annual.value.map(async (file) => {
        const rows = await fetchCsv(file.url)
        return { ...file, rows, latest: lastPositiveRow(rows) }
      }),
    )
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// The last row (chronologically latest) whose level_average is a positive number.
function lastPositiveRow(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].level_average > 0) return rows[i]
  }
  return null
}

// autoType parses the `date` column into a Date; render it as a plain YYYY-MM-DD.
function formatDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value
}

// Sort key from the (water) year in a filename, e.g. "SiomaBridge_WY2024-2025.csv" -> 2025.
function fileYear(name) {
  const years = name.match(/\d{4}/g)
  return years ? Math.max(...years.map(Number)) : -Infinity
}

// The latest record overall: last positive reading in the highest-year CSV file.
const latestRecord = computed(() => {
  let best = null
  for (const file of datasets.value) {
    if (!file.latest) continue
    if (!best || fileYear(file.name) > fileYear(best.name)) best = file
  }
  return best
})

onMounted(loadAll)
</script>

<template>
  <main>
    <h1>Available gauge data annual</h1>

    <p v-if="loading">Loading…</p>

    <p v-else-if="error" class="error">
      Failed to load annual: {{ error }}
      <button @click="loadAll">Retry</button>
    </p>

    <p v-else-if="datasets.length === 0">No CSV annual found.</p>

    <template v-else>
      <section v-if="latestRecord" class="latest">
        <h2>Latest reading</h2>
        <p class="reading">{{ latestRecord.latest.level_average }} m</p>
        <p class="meta">
          {{ formatDate(latestRecord.latest.date) }} · from {{ latestRecord.name }}
        </p>
      </section>

    <table class="annual">
      <thead>
        <tr>
          <th>File</th>
          <th>Latest reading date</th>
          <th>Level average</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in datasets" :key="file.name">
          <td><a :href="file.url" target="_blank" rel="noopener">{{ file.name }}</a></td>
          <template v-if="file.latest">
            <td>{{ formatDate(file.latest.date) }}</td>
            <td>{{ file.latest.level_average }}</td>
          </template>
          <template v-else>
            <td colspan="2">No positive reading</td>
          </template>
        </tr>
      </tbody>
    </table>
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

table.annual {
  width: 100%;
  border-collapse: collapse;
}

table.annual th,
table.annual td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #ddd;
}

table.annual th {
  border-bottom: 2px solid #999;
}

.error {
  color: #b00020;
}

button {
  margin-left: 0.5rem;
}
</style>
