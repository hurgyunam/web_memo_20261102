<script setup lang="ts">
import type { MemoCommit, MemoCommitResult, MemoItem, MemoSaveRequest } from '~/types/memo'
import type { TagItem } from '~/types/tag'
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
const committing = ref(false)
const message = ref('')
const commitNotice = ref('')
const knownServerBody = ref<string | null>(null)
const tagQuery = ref('')
const tagMenuOpen = ref(false)
const suggestionIndex = ref(-1)
const suggestionFromKeyboard = ref(false)
const selectedTagIds = ref<string[]>([])
const pendingLinkIds = ref<string[]>([])
const optimisticTags = ref<TagItem[]>([])
const addingTag = ref(false)
const unlinkingId = ref('')
const tagMessage = ref('')
let tagFocusTimer: ReturnType<typeof setTimeout> | undefined
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

const {
  data: tagCatalog,
  error: tagCatalogError,
  pending: catalogPending,
  refresh: refreshCatalog,
} = await useFetch<{ tags: TagItem[] }>('/api/tags', {
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const {
  data: linkedData,
  error: linkedError,
  pending: linkedPending,
  refresh: refreshLinked,
} = await useFetch<{ tags: TagItem[] }>(() => `/api/memos/${memoId.value}/tags`, {
  watch: [memoId],
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const {
  data: commitData,
  error: commitError,
  pending: commitsPending,
  refresh: refreshCommits,
} = await useFetch<{ commits: MemoCommit[] }>(() => `/api/memos/${memoId.value}/commits`, {
  watch: [memoId],
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const memo = computed(() => data.value ?? null)
const accountTags = computed(() => tagCatalog.value?.tags ?? [])
const linkedTags = computed(() => {
  const saved = linkedData.value?.tags ?? []
  const savedIds = new Set(saved.map((tag) => tag.id))
  return [
    ...saved,
    ...optimisticTags.value.filter((tag) => !savedIds.has(tag.id)),
  ]
})
const linkedTagIds = computed(() => new Set(linkedTags.value.map((tag) => tag.id)))
const tagSuggestions = computed(() => {
  const query = tagQuery.value.trim().toLowerCase()
  return accountTags.value.filter((tag) => {
    if (linkedTagIds.value.has(tag.id)) {
      return false
    }
    if (!query) {
      return true
    }
    return tag.name.toLowerCase().includes(query)
  })
})
const selectedTags = computed(() => {
  const selected = new Set(selectedTagIds.value)
  return accountTags.value.filter((tag) => selected.has(tag.id) && !linkedTagIds.value.has(tag.id))
})
const showTagSuggestions = computed(() => tagMenuOpen.value && tagSuggestions.value.length > 0)
const tagSubmitLabel = computed(() => {
  const count = selectedTags.value.length
  if (count > 0) {
    return `${count}개 추가`
  }
  return addingTag.value ? '추가 중' : '추가'
})
const activeSuggestionId = computed(() => {
  const tag = tagSuggestions.value[suggestionIndex.value]
  return tag ? `memo-tag-option-${tag.id}` : undefined
})
const tagLoadError = computed(() => {
  if (tagMessage.value) {
    return tagMessage.value
  }
  if (tagCatalogError.value) {
    return accountErrorMessage(tagCatalogError.value, '태그 목록을 불러오지 못했습니다.')
  }
  if (linkedError.value) {
    return accountErrorMessage(linkedError.value, '연결된 태그를 불러오지 못했습니다.')
  }
  return ''
})
const savePhase = computed(() => view.value?.phase ?? 'saved')
const saveLabel = computed(() => savePhaseLabel(savePhase.value))
const saveDataState = computed(() => (savePhase.value === 'saved' ? 'ok' : savePhase.value))
const draft = computed(() => view.value?.draft ?? '')
const canSave = computed(() => view.value !== null && beginSave(view.value) !== null && !committing.value)
const commits = computed(() => commitData.value?.commits ?? [])
const canCommit = computed(() => {
  const current = view.value
  if (!current || committing.value || resolving.value || causingConflict.value) {
    return false
  }
  if (current.phase === 'saving' || current.phase === 'conflict') {
    return false
  }
  const head = commits.value[0]
  return !head || head.body !== current.draft
})
const commitTitle = computed(() => {
  if (committing.value) {
    return '커밋 중'
  }
  const current = view.value
  const head = commits.value[0]
  if (current && head && head.body === current.draft && current.phase !== 'saving' && current.phase !== 'conflict') {
    return '마지막 커밋과 같습니다'
  }
  return '현재 본문을 히스토리에 남깁니다'
})
const commitLoadError = computed(() => {
  if (commitError.value) {
    return accountErrorMessage(commitError.value, '히스토리를 불러오지 못했습니다.')
  }
  return ''
})
const loadError = computed(() => {
  if (message.value) {
    return message.value
  }
  if (error.value) {
    return accountErrorMessage(error.value, '메모를 불러오지 못했습니다.')
  }
  return ''
})

watch(memo, (item) => {
  if (!item || item.id !== memoId.value || knownServerBody.value !== null) {
    return
  }
  knownServerBody.value = item.body
}, { immediate: true })

watch(memoId, () => {
  view.value = null
  requestSerial += 1
  commitNotice.value = ''
  const current = memo.value
  knownServerBody.value = current && current.id === memoId.value ? current.body : null
  tagQuery.value = ''
  tagMenuOpen.value = false
  suggestionIndex.value = -1
  suggestionFromKeyboard.value = false
  selectedTagIds.value = []
  pendingLinkIds.value = []
  optimisticTags.value = []
  tagMessage.value = ''
})

watch(linkedData, () => {
  const savedIds = new Set((linkedData.value?.tags ?? []).map((tag) => tag.id))
  optimisticTags.value = optimisticTags.value.filter((tag) => !savedIds.has(tag.id))
  selectedTagIds.value = selectedTagIds.value.filter((id) => !savedIds.has(id))
})

watch(tagQuery, () => {
  suggestionIndex.value = -1
  suggestionFromKeyboard.value = false
})

watch(() => view.value?.draft, (next, prev) => {
  if (prev !== undefined && next !== prev) {
    commitNotice.value = ''
  }
})

onMounted(() => {
  document.addEventListener('visibilitychange', refreshTagsWhenVisible)
  autoSaveTimer = setInterval(() => {
    if (committing.value || !view.value || !shouldAutoSave(view.value)) {
      return
    }
    void saveDraft()
  }, AUTO_SAVE_INTERVAL_MS)
})

onBeforeUnmount(() => {
  alive = false
  requestSerial += 1
  document.removeEventListener('visibilitychange', refreshTagsWhenVisible)
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
  }
  if (tagFocusTimer) {
    clearTimeout(tagFocusTimer)
  }
})

function refreshTagsWhenVisible() {
  if (document.visibilityState !== 'visible') {
    return
  }
  void refreshCatalog()
  void refreshLinked()
}

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

async function saveDraft(): Promise<boolean> {
  const started = view.value ? beginSave(view.value) : null
  if (!memo.value || !started) {
    return false
  }
  return saveSnapshot(started.snapshot, started.baseVersion)
}

async function saveSnapshot(snapshot: string, baseVersion: number): Promise<boolean> {
  const current = memo.value
  if (!current || !view.value || view.value.phase === 'conflict') {
    return false
  }
  const token = ++requestSerial
  const memoIdAtStart = current.id
  view.value = { ...view.value, phase: 'saving' }
  try {
    const saved = await $fetch<MemoItem>(`/api/memos/${memoIdAtStart}`, {
      method: 'PUT',
      body: {
        body: snapshot,
        baseVersion,
      } satisfies MemoSaveRequest,
    })
    if (!alive || token !== requestSerial || !view.value) {
      return false
    }
    view.value = applySaveSuccess(view.value, snapshot, saved.version)
    knownServerBody.value = snapshot
    return true
  } catch (caught) {
    if (!alive || token !== requestSerial || !view.value) {
      return false
    }
    view.value = isMemoConflict(caught) ? applySaveConflict(view.value) : applySaveFailure(view.value)
    return false
  }
}

async function commitHistory() {
  const currentMemo = memo.value
  const currentView = view.value
  if (!currentMemo || !currentView || !canCommit.value || committing.value) {
    return
  }
  committing.value = true
  commitNotice.value = ''
  message.value = ''
  const memoIdAtStart = currentMemo.id
  try {
    if (beginSave(currentView)) {
      const saved = await saveDraft()
      if (!alive || memo.value?.id !== memoIdAtStart) {
        return
      }
      if (!saved || !view.value) {
        if (view.value?.phase === 'conflict') {
          message.value = '충돌을 해결한 뒤에 커밋할 수 있습니다.'
        } else if (!message.value) {
          message.value = '저장하지 못해 커밋하지 못했습니다.'
        }
        return
      }
    }
    if (view.value && knownServerBody.value !== view.value.baseline) {
      const saved = await saveSnapshot(view.value.baseline, view.value.baselineVersion)
      if (!alive || memo.value?.id !== memoIdAtStart) {
        return
      }
      if (!saved || !view.value) {
        if (view.value?.phase === 'conflict') {
          message.value = '충돌을 해결한 뒤에 커밋할 수 있습니다.'
        } else if (!message.value) {
          message.value = '저장하지 못해 커밋하지 못했습니다.'
        }
        return
      }
    }
    const ready = view.value
    if (!alive || !ready || memo.value?.id !== memoIdAtStart) {
      return
    }
    const result = await $fetch<MemoCommitResult>(`/api/memos/${memoIdAtStart}/commits`, {
      method: 'POST',
      body: {
        body: ready.baseline,
        baseVersion: ready.baselineVersion,
      } satisfies MemoSaveRequest,
    })
    if (!alive || memo.value?.id !== memoIdAtStart) {
      return
    }
    commitNotice.value = result.kind === 'created' ? '커밋했습니다.' : '마지막 커밋과 같은 본문입니다.'
    await refreshCommits()
  } catch (caught) {
    if (!alive || memo.value?.id !== memoIdAtStart) {
      return
    }
    if (isMemoConflict(caught) && view.value) {
      view.value = applySaveConflict(view.value)
    }
    message.value = accountErrorMessage(caught, '커밋하지 못했습니다.')
  } finally {
    committing.value = false
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
    knownServerBody.value = latest.body
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
    knownServerBody.value = snapshot
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

function findExistingTag(name: string): TagItem | undefined {
  const trimmed = name.trim()
  const folded = trimmed.toLowerCase()
  return accountTags.value.find((tag) => tag.name === trimmed)
    ?? accountTags.value.find((tag) => tag.name.toLowerCase() === folded)
}

function onTagKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    tagMenuOpen.value = true
    suggestionFromKeyboard.value = true
    const count = tagSuggestions.value.length
    if (count === 0) {
      return
    }
    if (event.key === 'ArrowDown') {
      suggestionIndex.value = suggestionIndex.value + 1 >= count ? 0 : suggestionIndex.value + 1
      return
    }
    suggestionIndex.value = suggestionIndex.value <= 0 ? count - 1 : suggestionIndex.value - 1
    return
  }
  if (event.key === ' ' && tagMenuOpen.value && suggestionFromKeyboard.value && suggestionIndex.value >= 0) {
    event.preventDefault()
    const tag = tagSuggestions.value[suggestionIndex.value]
    if (tag) {
      toggleTagSelection(tag)
    }
    return
  }
  if (event.key === 'Escape') {
    closeTagMenu()
  }
}

function closeTagMenu() {
  tagMenuOpen.value = false
  suggestionIndex.value = -1
  suggestionFromKeyboard.value = false
}

function onTagFocusOut(event: FocusEvent) {
  const form = event.currentTarget
  if (!(form instanceof HTMLElement)) {
    return
  }
  const next = event.relatedTarget
  if (next instanceof Node && form.contains(next)) {
    return
  }
  if (tagFocusTimer) {
    clearTimeout(tagFocusTimer)
  }
  tagFocusTimer = setTimeout(() => {
    if (!alive || form.contains(document.activeElement)) {
      return
    }
    closeTagMenu()
  }, 0)
}

function toggleTagSelection(tag: TagItem) {
  if (linkedTagIds.value.has(tag.id) || pendingLinkIds.value.includes(tag.id)) {
    return
  }
  if (selectedTagIds.value.includes(tag.id)) {
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== tag.id)
    return
  }
  selectedTagIds.value = [...selectedTagIds.value, tag.id]
}

async function linkTags(memoIdAtStart: string, tags: TagItem[]) {
  const known = new Set([
    ...(linkedData.value?.tags ?? []).map((tag) => tag.id),
    ...optimisticTags.value.map((tag) => tag.id),
    ...pendingLinkIds.value,
  ])
  const fresh = tags.filter((tag) => !known.has(tag.id))
  if (fresh.length === 0) {
    return
  }
  tagMessage.value = ''
  pendingLinkIds.value = [...pendingLinkIds.value, ...fresh.map((tag) => tag.id)]
  optimisticTags.value = [...optimisticTags.value, ...fresh]
  tagMenuOpen.value = true
  const failedNames: string[] = []
  let failureMessage = ''
  await Promise.all(fresh.map(async (tag) => {
    try {
      await $fetch<TagItem>(`/api/memos/${memoIdAtStart}/tags`, {
        method: 'POST',
        body: { tagId: tag.id },
      })
    } catch (caught) {
      failedNames.push(tag.name)
      optimisticTags.value = optimisticTags.value.filter((item) => item.id !== tag.id)
      pendingLinkIds.value = pendingLinkIds.value.filter((id) => id !== tag.id)
      if (!failureMessage) {
        failureMessage = accountErrorMessage(caught, '태그를 연결하지 못했습니다.')
      }
    }
  }))
  if (!alive || memo.value?.id !== memoIdAtStart) {
    return
  }
  if (failedNames.length === 1) {
    tagMessage.value = failureMessage
  } else if (failedNames.length > 1) {
    tagMessage.value = `${failureMessage} (${failedNames.join(', ')})`
  }
  const finishedIds = new Set(fresh.map((tag) => tag.id))
  try {
    await refreshLinked()
  } catch (caught) {
    if (!tagMessage.value) {
      tagMessage.value = accountErrorMessage(caught, '연결된 태그를 불러오지 못했습니다.')
    }
  } finally {
    pendingLinkIds.value = pendingLinkIds.value.filter((id) => !finishedIds.has(id))
  }
}

async function submitTagQuery() {
  const current = memo.value
  if (!current) {
    return
  }
  const chosen = selectedTags.value
  if (chosen.length > 0) {
    const chosenIds = new Set(chosen.map((tag) => tag.id))
    selectedTagIds.value = selectedTagIds.value.filter((id) => !chosenIds.has(id))
    tagMenuOpen.value = true
    void linkTags(current.id, chosen)
    return
  }
  if (addingTag.value) {
    return
  }
  const picked = tagSuggestions.value[suggestionIndex.value]
  if (picked) {
    tagMenuOpen.value = true
    void linkTags(current.id, [picked])
    return
  }
  const trimmed = tagQuery.value.trim()
  if (!trimmed) {
    tagMessage.value = '입력 오류: 태그 이름을 입력해 주세요.'
    return
  }
  const existing = findExistingTag(trimmed)
  if (existing) {
    tagMenuOpen.value = true
    void linkTags(current.id, [existing])
    return
  }
  addingTag.value = true
  tagMessage.value = ''
  const memoIdAtStart = current.id
  try {
    const created = await createOrFindTag(trimmed)
    if (!alive || memo.value?.id !== memoIdAtStart) {
      return
    }
    tagQuery.value = ''
    tagMenuOpen.value = true
    void refreshCatalog()
    void linkTags(memoIdAtStart, [created])
  } catch (caught) {
    if (!alive || memo.value?.id !== memoIdAtStart) {
      return
    }
    tagMessage.value = accountErrorMessage(caught, '태그를 추가하지 못했습니다.')
  } finally {
    addingTag.value = false
  }
}

async function createOrFindTag(name: string): Promise<TagItem> {
  try {
    return await $fetch<TagItem>('/api/tags', {
      method: 'POST',
      body: { name },
    })
  } catch (caught) {
    await refreshCatalog()
    const existing = findExistingTag(name)
    if (existing) {
      return existing
    }
    throw caught
  }
}

async function unlinkTag(tag: TagItem) {
  const current = memo.value
  if (!current || unlinkingId.value || pendingLinkIds.value.includes(tag.id)) {
    return
  }
  unlinkingId.value = tag.id
  tagMessage.value = ''
  try {
    await $fetch(`/api/memos/${current.id}/tags/${tag.id}`, { method: 'DELETE' })
    await refreshLinked()
  } catch (caught) {
    tagMessage.value = accountErrorMessage(caught, '태그 연결을 제거하지 못했습니다.')
  } finally {
    unlinkingId.value = ''
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

function formatCommitted(value: string): string {
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
        <p class="lead">위지윅으로 고칩니다. 저장하거나, 바꾸면 자동으로 저장됩니다. Commit은 그 시점의 본문을 히스토리에 쌓습니다.</p>
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
          v-if="memo"
          class="submit commit-button"
          type="button"
          data-commit-button
          :title="commitTitle"
          :disabled="!canCommit"
          :aria-busy="committing ? 'true' : 'false'"
          @click="commitHistory"
        >
          {{ committing ? '커밋 중' : 'Commit' }}
        </button>
        <button
          v-if="isLocalDev && memo"
          class="dev-conflict"
          type="button"
          :disabled="causingConflict || resolving || committing || savePhase === 'saving' || !view"
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
      <section
        class="memo-history"
        aria-label="커밋 히스토리"
      >
        <h2>히스토리</h2>
        <p
          v-if="commitNotice"
          class="notice"
          role="status"
        >
          {{ commitNotice }}
        </p>
        <p
          v-if="commitLoadError"
          class="alert"
          role="alert"
        >
          {{ commitLoadError }}
        </p>
        <p
          v-if="commitsPending && commits.length === 0 && !commitLoadError"
          class="lead"
        >
          히스토리를 불러오는 중
        </p>
        <p
          v-else-if="commits.length === 0 && !commitLoadError"
          class="lead"
        >
          아직 커밋이 없습니다.
        </p>
        <ol
          v-else-if="commits.length > 0"
          class="commit-list"
        >
          <li
            v-for="commit in commits"
            :key="commit.id"
            class="commit-entry"
            :data-commit-seq="commit.seq"
          >
            <details>
              <summary>
                <span class="commit-seq">#{{ commit.seq }}</span>
                <time :datetime="commit.createdAt">{{ formatCommitted(commit.createdAt) }}</time>
                <span class="commit-preview">{{ preview(commit.body) }}</span>
              </summary>
              <pre class="commit-body">{{ commit.body }}</pre>
            </details>
          </li>
        </ol>
      </section>
      <section
        class="memo-tag-box"
        aria-label="태그"
      >
        <h2 id="memo-tag-heading">태그</h2>
        <p
          v-if="tagLoadError"
          class="alert"
          role="alert"
        >
          {{ tagLoadError }}
        </p>
        <form
          class="tag-link-form"
          novalidate
          @submit.prevent="submitTagQuery"
          @focusout="onTagFocusOut"
        >
          <div class="tag-suggest">
            <div class="field">
              <input
                v-model="tagQuery"
                type="text"
                name="tag"
                role="combobox"
                autocomplete="off"
                spellcheck="false"
                aria-autocomplete="list"
                aria-controls="memo-tag-suggestions"
                aria-labelledby="memo-tag-heading"
                :aria-expanded="showTagSuggestions ? 'true' : 'false'"
                :aria-activedescendant="activeSuggestionId"
                @focus="tagMenuOpen = true"
                @click="tagMenuOpen = true"
                @input="tagMenuOpen = true"
                @keydown="onTagKeydown"
              >
            </div>
            <ul
              v-if="showTagSuggestions"
              id="memo-tag-suggestions"
              class="tag-suggest-list"
              role="group"
              aria-label="추가할 태그"
            >
              <li
                v-for="(tag, index) in tagSuggestions"
                :key="tag.id"
              >
                <label
                  :id="`memo-tag-option-${tag.id}`"
                  class="tag-suggest-option"
                  :data-active="index === suggestionIndex ? 'true' : 'false'"
                  @mouseenter="suggestionIndex = index; suggestionFromKeyboard = false"
                  @mousedown.prevent
                  @click.prevent="toggleTagSelection(tag)"
                >
                  <input
                    type="checkbox"
                    tabindex="-1"
                    :value="tag.id"
                    :checked="selectedTagIds.includes(tag.id)"
                  >
                  <span>{{ tag.name }}</span>
                </label>
              </li>
            </ul>
          </div>
          <button
            class="submit"
            type="submit"
            :disabled="addingTag && selectedTags.length === 0"
          >
            {{ tagSubmitLabel }}
          </button>
        </form>
        <p
          v-if="(catalogPending || linkedPending) && linkedTags.length === 0 && !tagLoadError"
          class="lead"
        >
          태그를 불러오는 중
        </p>
        <p
          v-else-if="linkedTags.length === 0 && !linkedError"
          class="lead"
        >
          연결된 태그가 없습니다.
        </p>
        <ul
          v-else-if="linkedTags.length > 0"
          class="memo-tags"
        >
          <li
            v-for="tag in linkedTags"
            :key="tag.id"
            class="memo-tag"
            :data-memo-tag="tag.id"
            :data-tag-name="tag.name"
            :data-linking="pendingLinkIds.includes(tag.id) ? 'true' : 'false'"
          >
            <span class="memo-tag-name">{{ tag.name }}</span>
            <button
              class="memo-tag-remove"
              type="button"
              :aria-label="`${tag.name} 삭제`"
              :disabled="unlinkingId === tag.id || pendingLinkIds.includes(tag.id)"
              @click="unlinkTag(tag)"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        </ul>
      </section>
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
