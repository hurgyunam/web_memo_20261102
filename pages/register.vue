<script setup lang="ts">
const email = ref('')
const password = ref('')
const pending = ref(false)
const message = ref('')

useHead({ title: '회원가입 · 메모' })

async function submit() {
  pending.value = true
  message.value = ''
  try {
    await $fetch('/api/auth/register', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
      },
    })
    password.value = ''
    await navigateTo('/login?joined=1')
  } catch (error) {
    message.value = accountErrorMessage(error, '입력 오류')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>회원가입</h1>
    <p class="lead">이메일과 비밀번호로 계정을 만듭니다. 가입만으로는 로그인되지 않습니다.</p>
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
          autocomplete="email"
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
          autocomplete="new-password"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? '확인 중' : '가입하기' }}
      </button>
    </form>
    <p class="lead">
      이미 계정이 있으면
      <NuxtLink
        class="text-link"
        to="/login"
      >
        로그인
      </NuxtLink>
    </p>
  </section>
</template>
