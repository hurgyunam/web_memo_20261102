<script setup lang="ts">
const password = ref('')
const pending = ref(false)
const message = ref('')
const saved = ref(false)

const { data: readyState } = await useFetch<{ ready: boolean }>('/api/auth/change-ready')
const { data: session } = await useAccountSession()
const ready = computed(() => readyState.value?.ready === true)

useHead({ title: '새 비밀번호 · 메모' })

async function submit() {
  pending.value = true
  message.value = ''
  try {
    await $fetch('/api/auth/secret', {
      method: 'POST',
      body: {
        password: password.value,
      },
    })
    password.value = ''
    saved.value = true
    if (readyState.value) {
      readyState.value = { ready: false }
    }
    await refreshNuxtData('account-session')
  } catch (error) {
    message.value = accountErrorMessage(error, '입력 오류')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>새 비밀번호</h1>
    <p
      v-if="saved"
      class="notice"
      role="status"
    >
      비밀번호를 변경했습니다.
    </p>
    <p
      v-else-if="ready"
      class="lead"
    >
      새 비밀번호를 입력해 주세요.
    </p>
    <p
      v-else
      class="alert"
      role="alert"
    >
      보안코드 인증이 필요합니다.
    </p>
    <p
      v-if="message"
      class="alert"
      role="alert"
    >
      {{ message }}
    </p>
    <form
      v-if="ready && !saved"
      class="form"
      novalidate
      @submit.prevent="submit"
    >
      <label class="field">
        <span>새 비밀번호</span>
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? '저장 중' : '저장' }}
      </button>
    </form>
    <p class="lead">
      <NuxtLink
        v-if="session?.email"
        class="text-link"
        to="/memos"
      >
        메모 목록
      </NuxtLink>
      <NuxtLink
        v-else-if="saved"
        class="text-link"
        to="/login"
      >
        로그인
      </NuxtLink>
      <NuxtLink
        v-else
        class="text-link"
        to="/password"
      >
        보안코드 받기
      </NuxtLink>
    </p>
  </section>
</template>
