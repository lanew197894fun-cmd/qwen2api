import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/': {
        target: 'http://localhost:4000', // 實際後端地址
        changeOrigin: true,
      }
    }
  }
})
