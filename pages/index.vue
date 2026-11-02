<script setup lang="ts">
type HealthResponse = {
  ok: boolean
}

const { data, error, pending } = await useFetch<HealthResponse>('/api/health')

const statusText = computed(() => {
  if (pending.value) {
    return '확인 중'
  }
  if (error.value || data.value?.ok !== true) {
    return '응답 없음'
  }
  return '연결됨'
})
</script>

<template>
  <section class="home">
    <h1>홈</h1>
    <p class="lead">
      이 화면은 Nuxt 페이지이고, 아래 상태는 같은 앱의 server/api가 돌려준 값이다.
    </p>
    <p
      class="status"
      :data-state="statusText === '연결됨' ? 'ok' : 'wait'"
      role="status"
    >
      <span class="status-label">API /api/health</span>
      <span class="status-value">{{ statusText }}</span>
    </p>
  </section>
</template>
