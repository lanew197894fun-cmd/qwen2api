<template>
  <div class="inline-flex items-stretch bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm overflow-hidden">
    <button
      v-for="(loc, i) in locales"
      :key="loc.code"
      @click="setLocale(loc.code)"
      :class="[
        'flex items-center justify-center px-2.5 py-1.5 transition-colors duration-200',
        locale === loc.code
          ? 'bg-indigo-100'
          : 'hover:bg-white/80',
        i > 0 ? 'border-l border-gray-200' : ''
      ]"
      :title="loc.label"
      :aria-label="loc.label"
      :aria-pressed="locale === loc.code">
      <svg v-if="loc.code === 'ru'" viewBox="0 0 9 6" class="w-6 h-4 rounded-sm shadow-inner" aria-hidden="true">
        <rect width="9" height="2" y="0" fill="#fff"/>
        <rect width="9" height="2" y="2" fill="#0039A6"/>
        <rect width="9" height="2" y="4" fill="#D52B1E"/>
      </svg>
      <svg v-else-if="loc.code === 'zh'" viewBox="0 0 30 20" class="w-6 h-4 rounded-sm shadow-inner" aria-hidden="true">
        <rect width="30" height="20" fill="#DE2910"/>
        <polygon points="6,3.5 7.18,7.13 11,7.13 7.91,9.37 9.09,13 6,10.76 2.91,13 4.09,9.37 1,7.13 4.82,7.13" fill="#FFDE00"/>
        <polygon points="12,2 12.4,3.2 13.66,3.2 12.63,3.94 13.03,5.14 12,4.4 10.97,5.14 11.37,3.94 10.34,3.2 11.6,3.2" fill="#FFDE00"/>
        <polygon points="14,4 14.4,5.2 15.66,5.2 14.63,5.94 15.03,7.14 14,6.4 12.97,7.14 13.37,5.94 12.34,5.2 13.6,5.2" fill="#FFDE00"/>
        <polygon points="14,7 14.4,8.2 15.66,8.2 14.63,8.94 15.03,10.14 14,9.4 12.97,10.14 13.37,8.94 12.34,8.2 13.6,8.2" fill="#FFDE00"/>
        <polygon points="12,9 12.4,10.2 13.66,10.2 12.63,10.94 13.03,12.14 12,11.4 10.97,12.14 11.37,10.94 10.34,10.2 11.6,10.2" fill="#FFDE00"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()

const locales = [
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' }
]

const setLocale = (code) => {
  locale.value = code
  localStorage.setItem('locale', code)
}
</script>
