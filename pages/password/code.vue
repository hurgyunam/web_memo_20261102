<script setup lang="ts">
const route = useRoute()
const code = ref('')
const pending = ref(false)
const message = ref('')
const email = computed(() => {
  const value = route.query.email
  return typeof value === 'string' ? value : ''
})

useHead({ title: '비밀번호 변경 코드 · 메모' })

async function submit() {
  pending.value = true
  message.value = ''
  try {
    await $fetch('/api/auth/security-code/change', {
      method: 'POST',
      body: {
        email: email.value,
        code: code.value,
      },
    })
    code.value = ''
    await navigateTo('/password/new')
  } catch (error) {
    message.value = accountErrorMessage(error, '인증 실패')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>보안코드 입력</h1>
    <p class="lead">
      <template v-if="email">
        {{ email }}로 보낸 비밀번호 변경 코드를 제한 시간 안에 입력해 주세요.
      </template>
      <template v-else>
        비밀번호 변경 코드를 받을 이메일이 없습니다.
      </template>
    </p>
    <p
      v-if="message"
      class="alert"
      role="alert"
    >
      {{ message }}
    </p>
    <form
      v-if="email"
      class="form"
      novalidate
      @submit.prevent="submit"
    >
      <label class="field">
        <span>보안코드</span>
        <input
          v-model="code"
          class="code"
          type="text"
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="8"
          spellcheck="false"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="pending"
      >
        {{ pending ? '확인 중' : '확인' }}
      </button>
    </form>
    <p class="lead">
      <NuxtLink
        class="text-link"
        to="/password"
      >
        코드 다시 받기
      </NuxtLink>
    </p>
  </section>
</template>
