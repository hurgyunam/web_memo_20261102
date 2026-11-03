<script setup lang="ts">
const route = useRoute()
const email = ref('')
const password = ref('')
const pending = ref(false)
const message = ref('')
const joined = computed(() => route.query.joined === '1')

useHead({ title: '로그인 · 메모' })

async function submit() {
  pending.value = true
  message.value = ''
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
      },
    })
    await refreshNuxtData('account-session')
    await navigateTo('/memos')
  } catch (error) {
    message.value = accountErrorMessage(error, '로그인 실패')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>로그인</h1>
    <p class="lead">이메일과 비밀번호로 들어갑니다.</p>
    <p
      v-if="joined && !message"
      class="notice"
      role="status"
    >
      가입되었습니다. 로그인하면 메모 목록으로 이동합니다.
    </p>
    <p
      v-if="message"
      class="alert"
      role="alert"
    >
      {{ message }}
    </p>
    <form
      class="form"
      novalidate
      @submit.prevent="submit"
    >
      <label class="field">
        <span>이메일</span>
        <input
          v-model="email"
          type="email"
          name="email"
          autocomplete="username"
          inputmode="email"
          spellcheck="false"
        >
      </label>
      <label class="field">
        <span>비밀번호</span>
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? '확인 중' : '로그인' }}
      </button>
    </form>
    <p class="lead">
      <NuxtLink
        class="text-link"
        to="/login/code"
      >
        보안코드로 로그인
      </NuxtLink>
      ·
      <NuxtLink
        class="text-link"
        to="/password"
      >
        비밀번호 변경
      </NuxtLink>
    </p>
    <p class="lead">
      계정이 없으면
      <NuxtLink
        class="text-link"
        to="/register"
      >
        회원가입
      </NuxtLink>
    </p>
  </section>
</template>
