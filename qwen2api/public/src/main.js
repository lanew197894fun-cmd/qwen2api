import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import router from './routes/index.js'
import App from './App.vue'
import ru from './locales/ru.json'
import zh from './locales/zh.json'
import "./style.css"

const detectLocale = () => {
  const stored = localStorage.getItem('locale')
  if (stored === 'ru' || stored === 'zh') return stored
  return navigator.language?.startsWith('ru') ? 'ru' : 'zh'
}

const i18n = createI18n({
  locale: detectLocale(),
  fallbackLocale: 'zh',
  messages: { ru, zh },
  globalInjection: true
})

createApp(App)
  .use(i18n)
  .use(router)
  .mount('#app')
