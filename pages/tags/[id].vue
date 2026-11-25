<script setup lang="ts">
import type { TagMemoAssign } from '~/types/tag'

const route = useRoute()
const nuxtApp = useNuxtApp()
const selectedIds = ref<string[]>([])
const linking = ref(false)
const message = ref('')
const notice = ref('')

const tagId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : value
})

const { data, error, pending, refresh } = await useFetch<TagMemoAssign>(() => `/api/tags/${tagId.value}/memos`, {
  watch: [tagId],
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const tag = computed(() => data.value?.tag ?? null)
const memos = computed(() => data.value?.memos ?? [])
const unlinkedMemos = computed(() => memos.value.filter((memo) => !memo.linked))
const allUnlinkedSelected = computed(() => unlinkedMemos.value.length > 0
  && unlinkedMemos.value.every((memo) => selectedIds.value.includes(memo.id)))
const loadError = computed(() => {
  if (message.value) {
    return message.value
  }
  if (error.value) {
    return accountErrorMessage(error.value, '메모 목록을 불러오지 못했습니다.')
  }
  return ''
})
const submitLabel = computed(() => {
  if (linking.value) {
    return '연결 중'
  }
  if (selectedIds.value.length > 0) {
    return `${selectedIds.value.length}개 연결`
  }
  return '연결'
})

useHead({
  title: computed(() => (tag.value ? `${tag.value.name} 메모 지정 · 메모` : '메모 지정 · 메모')),
})

watch(tagId, () => {
  selectedIds.value = []
  message.value = ''
  notice.value = ''
})

function preview(body: string): string {
  const line = body.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
  if (!line) {
    return '빈 메모'
  }
  const title = line.replace(/^#{1,6}\s+/, '').trim()
  const shown = title || line
  return shown.length > 80 ? `${shown.slice(0, 80)}…` : shown
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

function toggleMemo(id: string, checked: boolean) {
  if (checked) {
    if (!selectedIds.value.includes(id)) {
      selectedIds.value = [...selectedIds.value, id]
    }
    return
  }
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
}

function toggleAll(checked: boolean) {
  selectedIds.value = checked ? unlinkedMemos.value.map((memo) => memo.id) : []
}

function onToggleAll(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) {
    return
  }
  toggleAll(input.checked)
}

function onToggleMemo(id: string, event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) {
    return
  }
  toggleMemo(id, input.checked)
}

async function linkSelected() {
  const currentId = tagId.value
  const memoIds = selectedIds.value.filter((id) => unlinkedMemos.value.some((memo) => memo.id === id))
  if (!currentId || memoIds.length === 0 || linking.value) {
    return
  }
  linking.value = true
  message.value = ''
  notice.value = ''
  try {
    const linked = await $fetch<{ memoIds: string[] }>(`/api/tags/${currentId}/memos`, {
      method: 'POST',
      body: { memoIds },
    })
    if (tagId.value !== currentId) {
      return
    }
    selectedIds.value = []
    notice.value = `${linked.memoIds.length}개 메모에 연결했습니다.`
    await refresh()
  } catch (caught) {
    if (tagId.value !== currentId) {
      return
    }
    message.value = accountErrorMessage(caught, '메모를 연결하지 못했습니다.')
  } finally {
    if (tagId.value === currentId) {
      linking.value = false
    }
  }
}
</script>

<template>
  <section class="panel tag-panel">
    <div>
      <h1>{{ tag ? `${tag.name} 메모 지정` : '메모 지정' }}</h1>
      <p class="lead">이 태그를 연결할 메모를 고릅니다. 이미 연결된 메모는 다시 연결하지 않습니다.</p>
    </div>
    <p>
      <NuxtLink
        class="text-link"
        to="/tags"
      >
        태그 목록
      </NuxtLink>
    </p>
    <p
      v-if="loadError"
      class="alert"
      role="alert"
    >
      {{ loadError }}
    </p>
    <p
      v-if="notice"
      class="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <p
      v-if="pending && !tag && !loadError"
      class="lead"
    >
      불러오는 중
    </p>
    <form
      v-else-if="tag"
      class="assign-form"
      novalidate
      @submit.prevent="linkSelected"
    >
      <p
        v-if="memos.length === 0"
        class="lead"
      >
        메모가 없습니다.
      </p>
      <template v-else>
        <label
          v-if="unlinkedMemos.length > 0"
          class="check"
        >
          <input
            type="checkbox"
            :checked="allUnlinkedSelected"
            @change="onToggleAll"
          >
          <span>연결 안 된 메모 모두 선택</span>
        </label>
        <ul class="assign-list">
          <li
            v-for="memo in memos"
            :key="memo.id"
          >
            <label class="assign-memo">
              <input
                type="checkbox"
                name="memo"
                :value="memo.id"
                :checked="memo.linked || selectedIds.includes(memo.id)"
                :disabled="memo.linked || linking"
                @change="onToggleMemo(memo.id, $event)"
              >
              <span class="assign-copy">
                <span class="memo-preview">{{ preview(memo.body) }}</span>
                <time
                  class="memo-time"
                  :datetime="memo.updatedAt"
                >{{ formatUpdated(memo.updatedAt) }}</time>
              </span>
              <span
                v-if="memo.linked"
                class="assign-state"
              >연결됨</span>
            </label>
          </li>
        </ul>
      </template>
      <button
        class="submit"
        type="submit"
        :disabled="linking || selectedIds.length === 0"
      >
        {{ submitLabel }}
      </button>
    </form>
  </section>
</template>
