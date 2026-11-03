<script setup lang="ts">
const route = useRoute()
const { data: session } = await useAccountSession()
const logoutError = ref('')
const loggedIn = computed(() => Boolean(session.value?.email))

const links = computed(() => {
  if (loggedIn.value) {
    return [
      { to: '/memos', label: '메모' },
      { to: '/tags', label: '태그' },
      { to: '/filters', label: '필터' },
    ]
  }
  return [
    { to: '/login', label: '로그인' },
    { to: '/register', label: '회원가입' },
  ]
})

function current(path: string): 'page' | undefined {
  if (path === '/') {
    return route.path === '/' ? 'page' : undefined
  }
  return route.path === path || route.path.startsWith(`${path}/`) ? 'page' : undefined
}

async function logout() {
  logoutError.value = ''
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    logoutError.value = '로그아웃하지 못했습니다.'
    return
  }
  session.value = { email: null }
  await refreshNuxtData('account-session')
  await navigateTo('/login')
}
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <div class="brand-block">
        <p class="brand">메모</p>
        <p
          v-if="session?.email"
          class="account"
        >
          {{ session.email }}
        </p>
      </div>
      <nav aria-label="주요">
        <NuxtLink
          to="/"
          :aria-current="current('/')"
        >
          홈
        </NuxtLink>
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :aria-current="current(link.to)"
        >
          {{ link.label }}
        </NuxtLink>
        <button
          v-if="loggedIn"
          type="button"
          @click="logout"
        >
          로그아웃
        </button>
      </nav>
    </aside>
    <main class="content">
      <p
        v-if="logoutError"
        class="alert"
        role="alert"
      >
        {{ logoutError }}
      </p>
      <slot />
    </main>
  </div>
</template>
