import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
  {
    path: '/',
    name: 'Home',
    meta: {title: 'Home'},
    component: () => import(/* webpackChunkName: "home" */ '@/views/HomeView.vue'),
  }
]
})

export default router
