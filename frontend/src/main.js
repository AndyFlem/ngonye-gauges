import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { registerPlugins } from '@/plugins'

const app = createApp(App)

app.use(router)

registerPlugins(app, { apiBaseUrl: import.meta.env.VITE_API_BASE_URL })
app.mount('#app')
