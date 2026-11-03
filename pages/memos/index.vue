<script setup lang="ts">
import type { MemoItem } from '~/types/memo'

useHead({ title: '메모' })

const nuxtApp = useNuxtApp()
const adding = ref(false)
const deletingId = ref('')
const message = ref('')

const { data, error, pending, refresh } = await useFetch<{ memos: MemoItem[] }>('/api/memos', {
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const memos = computed(() => data.value?.memos ?? [])
const loadError = computed(() => error.value
  ? accountErrorMessage(error.value, '메모 목록을 불러오지 못했습니다.')
  : '')

async function addMemo() {
  adding.value = true
  message.value = ''
  try {
    const created = await $fetch<MemoItem>('/api/memos', { method: 'POST' })
    await navigateTo(`/memos/${created.id}`)
  } catch (caught) {
    message.value = accountErrorMessage(caught, '메모를 추가하지 못했습니다.')
  } finally {
    adding.value = false
  }
}

async function removeMemo(memo: MemoItem) {
  deletingId.value = memo.id
  message.value = ''
  try {
    await $fetch(`/api/memos/${memo.id}`, { method: 'DELETE' })
    await refresh()
  } catch (caught) {
    message.value = accountErrorMessage(caught, '메모를 삭제하지 못했습니다.')
  } finally {
    deletingId.value = ''
  }
}

function preview(body: string): string {
  const line = body.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
  if (!line) {
    return '빈 메모'
  }
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<template>
  <section class="panel memo-panel">
    <div class="memo-toolbar">
      <div>
        <h1>메모</h1>
        <p class="lead">이 계정의 메모를 최근 수정 순으로 보여 줍니다.</p>
      </div>
      <button
        class="submit"
        type="button"
        :disabled="adding"
        @click="addMemo"
      >
        {{ adding ? '추가 중' : '메모 추가' }}
      </button>
    </div>
    <p
      v-if="loadError || message"
      class="alert"
      role="alert"
    >
      {{ message || loadError }}
    </p>
    <p
      v-if="pending && memos.length === 0 && !loadError"
      class="lead"
    >
      불러오는 중
    </p>
    <p
      v-else-if="memos.length === 0 && !loadError"
      class="lead"
    >
      메모가 없습니다.
    </p>
    <ul
      v-else-if="memos.length > 0"
      class="memo-list"
    >
      <li
        v-for="memo in memos"
        :key="memo.id"
        class="memo-row"
      >
        <NuxtLink
          class="memo-link"
          :to="`/memos/${memo.id}`"
        >
          <span class="memo-preview">{{ preview(memo.body) }}</span>
          <time
            class="memo-time"
            :datetime="memo.updatedAt"
          >{{ formatUpdated(memo.updatedAt) }}</time>
        </NuxtLink>
        <button
          class="danger"
          type="button"
          :aria-label="`${preview(memo.body)} 삭제`"
          :disabled="deletingId === memo.id"
          @click="removeMemo(memo)"
        >
          {{ deletingId === memo.id ? '삭제 중' : '삭제' }}
        </button>
      </li>
    </ul>
  </section>
</template>
