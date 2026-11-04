<script setup lang="ts">
import type { MemoItem, MemoSaveRequest } from '~/types/memo'
import {
  AUTO_SAVE_INTERVAL_MS,
  applyDraft,
  applySaveConflict,
  applySaveFailure,
  applySaveSuccess,
  beginSave,
  createSaveView,
  isMemoConflict,
  savePhaseLabel,
  shouldAutoSave,
  type SaveView,
} from '~/utils/memo-save'

useHead({ title: '편집 · 메모' })

const route = useRoute()
const nuxtApp = useNuxtApp()
const deleting = ref(false)
const message = ref('')
const view = ref<SaveView | null>(null)
let alive = true
let requestSerial = 0
let autoSaveTimer: ReturnType<typeof setInterval> | undefined

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
const savePhase = computed(() => view.value?.phase ?? 'saved')
const saveLabel = computed(() => savePhaseLabel(savePhase.value))
const saveDataState = computed(() => (savePhase.value === 'saved' ? 'ok' : savePhase.value))
const draft = computed(() => view.value?.draft ?? '')
const canSave = computed(() => view.value !== null && beginSave(view.value) !== null)
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
  view.value = null
  requestSerial += 1
})

onMounted(() => {
  autoSaveTimer = setInterval(() => {
    if (!view.value || !shouldAutoSave(view.value)) {
      return
    }
    void saveDraft()
  }, AUTO_SAVE_INTERVAL_MS)
})

onBeforeUnmount(() => {
  alive = false
  requestSerial += 1
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
  }
})

function onBaseline(markdown: string) {
  const current = memo.value
  if (!current) {
    return
  }
  view.value = createSaveView(markdown, current.version)
}

function onDraft(markdown: string) {
  if (!view.value) {
    return
  }
  view.value = applyDraft(view.value, markdown)
}

async function saveDraft() {
  const current = memo.value
  const started = view.value ? beginSave(view.value) : null
  if (!current || !started) {
    return
  }
  const token = ++requestSerial
  const memoIdAtStart = current.id
  view.value = started.view
  try {
    const saved = await $fetch<MemoItem>(`/api/memos/${memoIdAtStart}`, {
      method: 'PUT',
      body: {
        body: started.snapshot,
        baseVersion: started.baseVersion,
      } satisfies MemoSaveRequest,
    })
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = applySaveSuccess(view.value, started.snapshot, saved.version)
  } catch (caught) {
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = isMemoConflict(caught) ? applySaveConflict(view.value) : applySaveFailure(view.value)
  }
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
        <p class="lead">위지윅으로 고칩니다. 저장하거나, 바꾸면 자동으로 저장됩니다.</p>
      </div>
      <div class="memo-actions">
        <span
          v-if="memo"
          class="save-slot"
          :title="saveLabel"
        >
          <button
            class="save-button"
            type="button"
            :data-state="saveDataState"
            :data-save-state="savePhase"
            :disabled="!canSave"
            :aria-busy="savePhase === 'saving'"
            :aria-label="saveLabel"
            @click="saveDraft"
          >
            <svg
              v-if="savePhase === 'saved'"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M5 12.5 9.5 17 19 7.5" />
            </svg>
            <svg
              v-else-if="savePhase === 'saving'"
              class="spin"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 4a8 8 0 1 1-7.5 5" />
            </svg>
            <svg
              v-else-if="savePhase === 'failed'"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 4 3.5 19h17L12 4z" />
              <path d="M12 10v4M12 16.5h.01" />
            </svg>
            <svg
              v-else-if="savePhase === 'conflict'"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 7h5a4 4 0 0 1 0 8H8" />
              <path d="M16 17h-5a4 4 0 0 1 0-8h5" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 4v11M8 11l4 4 4-4M5 20h14" />
            </svg>
          </button>
          <span
            class="save-live"
            role="status"
          >저장 상태 {{ saveLabel }}</span>
        </span>
        <NuxtLink
          class="text-link"
          to="/memos"
        >
          목록
        </NuxtLink>
      </div>
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
