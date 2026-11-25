<script setup lang="ts">
import type { AppliedFilter } from '~/types/filter'
import type { MemoItem, MemoList } from '~/types/memo'

useHead({ title: '메모' })

const route = useRoute()
const nuxtApp = useNuxtApp()
const adding = ref(false)
const deletingId = ref('')
const message = ref('')

const requestQuery = computed(() => {
  const query: Record<string, string> = {}
  const filter = queryText(route.query.filter)
  const include = queryText(route.query.include)
  const exclude = queryText(route.query.exclude)
  const keyword = queryText(route.query.keyword)
  if (filter) {
    query.filter = filter
  }
  if (include) {
    query.include = include
  }
  if (exclude) {
    query.exclude = exclude
  }
  if (keyword) {
    query.keyword = keyword
  }
  return query
})

const { data, error, pending, refresh } = await useFetch<MemoList>('/api/memos', {
  query: requestQuery,
  watch: [requestQuery],
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const memos = computed(() => data.value?.memos ?? [])
const applied = computed(() => data.value?.applied ?? null)
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
  const title = line.replace(/^#{1,6}\s+/, '').trim()
  const shown = title || line
  return shown.length > 80 ? `${shown.slice(0, 80)}…` : shown
}

function queryText(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }
  return typeof value === 'string' ? value : ''
}

function tagLabel(tags: { name: string }[]): string {
  return tags.length > 0 ? tags.map((tag) => tag.name).join(', ') : '없음'
}

function describeApplied(filter: AppliedFilter): string {
  const keyword = filter.keyword ? `키워드 “${filter.keyword}”` : '키워드 없음'
  return `포함 ${tagLabel(filter.includeTags)} · 제외 ${tagLabel(filter.excludeTags)} · ${keyword}`
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
        <p
          v-if="!loadError"
          class="lead"
        >
          {{ applied ? '이 조건에 맞는 메모를 최근 수정 순으로 보여 줍니다.' : '이 계정의 메모를 최근 수정 순으로 보여 줍니다.' }}
        </p>
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
    <div
      v-if="applied && !loadError"
      class="memo-filter"
    >
      <p>
        <strong>{{ applied.name || '입력한 조건' }}</strong>
      </p>
      <p>{{ describeApplied(applied) }}</p>
      <div class="memo-filter-actions">
        <button
          class="text-link"
          type="button"
          @click="navigateTo('/memos')"
        >
          전체 메모
        </button>
        <NuxtLink
          class="text-link"
          to="/filters"
        >
          필터
        </NuxtLink>
      </div>
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
      {{ applied ? '조건에 맞는 메모가 없습니다.' : '메모가 없습니다.' }}
    </p>
    <ul
      v-else-if="memos.length > 0 && !loadError"
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
