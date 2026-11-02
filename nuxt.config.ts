export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    tursoDatabaseUrl: '',
    tursoAuthToken: '',
  },
  typescript: {
    strict: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: '메모',
    },
  },
})
