<script setup lang="ts">
import type { MemoItem } from '~/types/memo'

useHead({ title: '편집 · 메모' })

const route = useRoute()
const nuxtApp = useNuxtApp()
const deleting = ref(false)
const message = ref('')
const baseline = ref<string | null>(null)
const draft = ref('')

const memoId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] ?? '' : value
})

const { data, error, pending } = await useFetch<MemoItem>(() => `/api/memos/${memoId.value}`, {
  watch: [memoId],
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const memo = computed(() => data.value ?? null)
const saveState = computed<'saved' | 'pending'>(() => {
  if (baseline.value === null || draft.value === baseline.value) {
    return 'saved'
  }
  return 'pending'
})
const saveLabel = computed(() => (saveState.value === 'saved' ? '저장됨' : '저장 대기'))
const loadError = computed(() => {
  if (message.value) {
    return message.value
  }
  if (error.value) {
    return accountErrorMessage(error.value, '메모를 불러오지 못했습니다.')
  }
  return ''
})

watch(memoId, () => {
  baseline.value = null
  draft.value = ''
})

function onBaseline(markdown: string) {
  baseline.value = markdown
  draft.value = markdown
}

function onDraft(markdown: string) {
  draft.value = markdown
}

async function removeMemo() {
  if (!memo.value) {
    return
  }
  deleting.value = true
  message.value = ''
  try {
    await $fetch(`/api/memos/${memo.value.id}`, { method: 'DELETE' })
    await navigateTo('/memos')
  } catch (caught) {
    message.value = accountErrorMessage(caught, '메모를 삭제하지 못했습니다.')
    deleting.value = false
  }
}
</script>

<template>
  <section class="panel memo-panel">
    <div class="memo-toolbar">
      <div>
        <h1>편집</h1>
        <p class="lead">위지윅으로 고칩니다. 저장될 값은 이 화면이 만든 마크다운입니다.</p>
      </div>
      <NuxtLink
        class="text-link"
        to="/memos"
      >
        목록
      </NuxtLink>
    </div>
    <p
      v-if="pending && !memo"
      class="lead"
    >
      불러오는 중
    </p>
    <p
      v-if="loadError"
      class="alert"
      role="alert"
    >
      {{ loadError }}
    </p>
    <template v-if="memo">
      <p
        class="status"
        :data-state="saveState === 'saved' ? 'ok' : 'pending'"
        :data-save-state="saveState"
        role="status"
      >
        <span class="status-label">저장 상태</span>
        <span class="status-value">{{ saveLabel }}</span>
      </p>
      <MemoWysiwyg
        :key="memo.id"
        :markdown="memo.body"
        @baseline="onBaseline"
        @draft="onDraft"
      />
      <pre
        class="memo-draft"
        data-memo-draft
        aria-hidden="true"
      >{{ draft }}</pre>
      <button
        class="danger"
        type="button"
        :disabled="deleting"
        @click="removeMemo"
      >
        {{ deleting ? '삭제 중' : '삭제' }}
      </button>
    </template>
  </section>
</template>
