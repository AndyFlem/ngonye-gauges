<template>
  <div ref="plotlyId" name="plotly"></div>
</template>

<script setup lang="ts">
  import { ref, onMounted, watchEffect } from 'vue'
  import * as Plotly from 'plotly.js-basic-dist'

  const props = defineProps({
    definition: {
      type: Object,
      required: true,
    }
  })

  const plotlyId = ref(null)
  const ready = ref(false)

  function setGraph() {
    if (!ready.value || !plotlyId.value || !props.definition) return

    Plotly.newPlot(plotlyId.value, props.definition.data, props.definition.layout, props.definition.config)
  }

  onMounted(() => {
    ready.value = true
    setGraph()
  })

  watchEffect(() => {
    setGraph()
  })
  </script>
