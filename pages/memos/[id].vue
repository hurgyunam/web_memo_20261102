<script setup lang="ts">
import type { MemoItem, MemoSaveRequest } from '~/types/memo'
import {
  AUTO_SAVE_INTERVAL_MS,
  acceptServerMemo,
  applyDraft,
  applyOverwriteFailure,
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
const isLocalDev = import.meta.dev
const deleting = ref(false)
const resolving = ref(false)
const causingConflict = ref(false)
const message = ref('')
const view = ref<SaveView | null>(null)
const wysiwyg = ref<{ replaceMarkdown: (markdown: string) => string } | null>(null)
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

async function keepServerMemo() {
  const current = memo.value
  if (!current || view.value?.phase !== 'conflict' || resolving.value) {
    return
  }
  const token = ++requestSerial
  resolving.value = true
  message.value = ''
  try {
    const latest = await $fetch<MemoItem>(`/api/memos/${current.id}`)
    if (!alive || token !== requestSerial || view.value?.phase !== 'conflict') {
      return
    }
    const markdown = wysiwyg.value?.replaceMarkdown(latest.body)
    if (typeof markdown !== 'string') {
      throw new Error('편집기가 없습니다.')
    }
    view.value = acceptServerMemo(markdown, latest.version)
  } catch (caught) {
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = applyOverwriteFailure(view.value)
    message.value = accountErrorMessage(caught, '마지막 저장본을 불러오지 못했습니다.')
  } finally {
    if (token === requestSerial) {
      resolving.value = false
    }
  }
}

async function keepCurrentDraft() {
  const current = memo.value
  const started = view.value
  if (!current || !started || started.phase !== 'conflict' || resolving.value) {
    return
  }
  const snapshot = started.draft
  const token = ++requestSerial
  resolving.value = true
  message.value = ''
  try {
    const latest = await $fetch<MemoItem>(`/api/memos/${current.id}`)
    const saved = await $fetch<MemoItem>(`/api/memos/${current.id}`, {
      method: 'PUT',
      body: {
        body: snapshot,
        baseVersion: latest.version,
      } satisfies MemoSaveRequest,
    })
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = applySaveSuccess(view.value, snapshot, saved.version)
  } catch (caught) {
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = applyOverwriteFailure(view.value)
    message.value = accountErrorMessage(caught, '현재 편집본을 저장하지 못했습니다.')
  } finally {
    if (token === requestSerial) {
      resolving.value = false
    }
  }
}

async function causeConflict() {
  if (!isLocalDev) {
    return
  }
  const current = memo.value
  const started = view.value
  if (!current || !started || causingConflict.value || resolving.value || started.phase === 'saving') {
    return
  }
  const token = ++requestSerial
  causingConflict.value = true
  message.value = ''
  const stamp = new Date().toLocaleString('ko-KR', { hour12: false })
  try {
    const latest = await $fetch<MemoItem>(`/api/memos/${current.id}`)
    await $fetch<MemoItem>(`/api/memos/${current.id}`, {
      method: 'PUT',
      body: {
        body: `${started.baseline}\n\n다른 화면에서 ${stamp}에 저장한 본문`,
        baseVersion: latest.version,
      } satisfies MemoSaveRequest,
    })
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    view.value = applySaveConflict(view.value)
  } catch (caught) {
    if (!alive || token !== requestSerial || !view.value) {
      return
    }
    message.value = accountErrorMessage(caught, '충돌을 만들지 못했습니다.')
  } finally {
    if (token === requestSerial) {
      causingConflict.value = false
    }
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
        <button
          v-if="isLocalDev && memo"
          class="dev-conflict"
          type="button"
          :disabled="causingConflict || resolving || savePhase === 'saving' || !view"
          @click="causeConflict"
        >
          {{ causingConflict ? '충돌 만드는 중' : '충돌 일으키기' }}
        </button>
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
      <div
        v-if="savePhase === 'conflict'"
        class="conflict-choice"
        role="group"
        aria-label="충돌 해결"
        :data-resolving="resolving ? 'true' : 'false'"
      >
        <p>마지막 저장본과 현재 편집본이 다릅니다. 어느 쪽을 살릴지 고르세요. 고르기 전에는 저장하지 않습니다.</p>
        <div class="conflict-actions">
          <button
            type="button"
            data-conflict-choice="server"
            :disabled="resolving"
            @click="keepServerMemo"
          >
            마지막 저장본 살리기
          </button>
          <button
            type="button"
            data-conflict-choice="draft"
            :disabled="resolving"
            @click="keepCurrentDraft"
          >
            현재 편집본 살리기
          </button>
        </div>
      </div>
      <MemoWysiwyg
        ref="wysiwyg"
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
