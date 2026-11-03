<script setup lang="ts">
const email = ref('')
const pending = ref(false)
const message = ref('')

useHead({ title: '비밀번호 변경 · 메모' })

async function submit() {
  pending.value = true
  message.value = ''
  try {
    await $fetch('/api/auth/security-code', {
      method: 'POST',
      body: {
        email: email.value,
        purpose: 'password_change',
      },
    })
    await navigateTo({
      path: '/password/code',
      query: { email: email.value.trim() },
    })
  } catch (error) {
    message.value = accountErrorMessage(error, '실패')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>비밀번호 변경</h1>
    <p class="lead">가입한 이메일로 비밀번호 변경 보안코드를 보냅니다. 코드를 확인한 뒤에 새 비밀번호를 입력합니다.</p>
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
      <button
        class="submit"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? '보내는 중' : '보안코드 받기' }}
      </button>
    </form>
    <p class="lead">
      <NuxtLink
        class="text-link"
        to="/login"
      >
        로그인
      </NuxtLink>
    </p>
  </section>
</template>
