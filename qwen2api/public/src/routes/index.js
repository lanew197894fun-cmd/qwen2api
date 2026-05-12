import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'

const routes = [
  {
    name: 'dashboard',
    path: '/',
    component: () => import('../views/dashboard.vue')
  },
  {
    name: 'auth',
    path: '/auth',
    component: () => import('../views/auth.vue')
  },
  {
    name: 'settings',
    path: '/settings',
    component: () => import('../views/settings.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})


// 路由守衛
router.beforeEach(async (to, from, next) => {

  if (to.path === '/auth') {
    next()
  } else {
    const apiKey = localStorage.getItem('apiKey')
    if (!apiKey) {
      alert('請先設定身份驗證apiKey')
      next({ path: '/auth' })
    } else {
      try {
        const verifyResponse = await axios.post('/verify', {
          apiKey: apiKey
        })

        if (verifyResponse.data.status === 200) {
          const isAdmin = verifyResponse.data.isAdmin

          // 儲存使用者許可權資訊
          localStorage.setItem('isAdmin', isAdmin.toString())

          // 檢查是否需要管理員許可權
          if ((to.path === '/' || to.path === '/settings') && !isAdmin) {
            alert('您沒有訪問管理頁面的許可權')
            next({ path: '/auth' })
            return
          }

          next()
        } else {
          localStorage.removeItem('apiKey')
          localStorage.removeItem('isAdmin')
          next({ path: '/auth' })
        }
      } catch (error) {
        localStorage.removeItem('apiKey')
        localStorage.removeItem('isAdmin')
        next({ path: '/auth' })
      }
    }
  }

})


export default router