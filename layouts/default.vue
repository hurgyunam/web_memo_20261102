<template>
  <div class="shell">
    <aside class="rail">
      <p class="brand">메모</p>
      <nav aria-label="주요">
        <NuxtLink to="/" aria-current="page">홈</NuxtLink>
      </nav>
    </aside>
    <main class="content">
      <slot />
    </main>
  </div>
</template>
