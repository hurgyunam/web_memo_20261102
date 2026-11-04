<script setup lang="ts">
import type { MemoItem, MemoSaveRequest } from '~/types/memo'
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
const message = ref('')
const tagQuery = ref('')
const tagMenuOpen = ref(false)
const suggestionIndex = ref(-1)
const addingTag = ref(false)
const linkingId = ref('')
const unlinkingId = ref('')
const tagMessage = ref('')
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

const memo = computed(() => data.value ?? null)
const accountTags = computed(() => tagCatalog.value?.tags ?? [])
const linkedTags = computed(() => linkedData.value?.tags ?? [])
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
const showTagSuggestions = computed(() => tagMenuOpen.value && tagSuggestions.value.length > 0)
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
  tagQuery.value = ''
  tagMenuOpen.value = false
  suggestionIndex.value = -1
  tagMessage.value = ''
})

watch(tagQuery, () => {
  suggestionIndex.value = -1
})

onMounted(() => {
  document.addEventListener('visibilitychange', refreshTagsWhenVisible)
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
  document.removeEventListener('visibilitychange', refreshTagsWhenVisible)
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
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
  if (event.key === 'Escape') {
    tagMenuOpen.value = false
    suggestionIndex.value = -1
  }
}

function closeTagMenu() {
  tagMenuOpen.value = false
  suggestionIndex.value = -1
}

async function chooseSuggestion(tag: TagItem) {
  const current = memo.value
  if (!current || addingTag.value || linkingId.value || unlinkingId.value) {
    return
  }
  linkingId.value = tag.id
  tagMessage.value = ''
  try {
    await $fetch<TagItem>(`/api/memos/${current.id}/tags`, {
      method: 'POST',
      body: { tagId: tag.id },
    })
    tagQuery.value = ''
    closeTagMenu()
    await refreshLinked()
  } catch (caught) {
    tagMessage.value = accountErrorMessage(caught, '태그를 연결하지 못했습니다.')
  } finally {
    linkingId.value = ''
  }
}

async function submitTagQuery() {
  if (!memo.value || addingTag.value || linkingId.value) {
    return
  }
  const picked = tagSuggestions.value[suggestionIndex.value]
  if (picked) {
    await chooseSuggestion(picked)
    return
  }
  const trimmed = tagQuery.value.trim()
  if (!trimmed) {
    tagMessage.value = '입력 오류: 태그 이름을 입력해 주세요.'
    return
  }
  const existing = findExistingTag(trimmed)
  if (existing) {
    await chooseSuggestion(existing)
    return
  }
  addingTag.value = true
  tagMessage.value = ''
  try {
    const created = await createOrFindTag(trimmed)
    await $fetch<TagItem>(`/api/memos/${memo.value.id}/tags`, {
      method: 'POST',
      body: { tagId: created.id },
    })
    tagQuery.value = ''
    closeTagMenu()
    await Promise.all([refreshCatalog(), refreshLinked()])
  } catch (caught) {
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
  if (!current || linkingId.value || unlinkingId.value) {
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
                @input="tagMenuOpen = true"
                @keydown="onTagKeydown"
                @blur="closeTagMenu"
              >
            </div>
            <ul
              v-if="showTagSuggestions"
              id="memo-tag-suggestions"
              class="tag-suggest-list"
              role="listbox"
            >
              <li
                v-for="(tag, index) in tagSuggestions"
                :key="tag.id"
              >
                <button
                  :id="`memo-tag-option-${tag.id}`"
                  type="button"
                  role="option"
                  :aria-selected="index === suggestionIndex"
                  :data-active="index === suggestionIndex ? 'true' : 'false'"
                  @mouseenter="suggestionIndex = index"
                  @mousedown.prevent="chooseSuggestion(tag)"
                >
                  {{ tag.name }}
                </button>
              </li>
            </ul>
          </div>
          <button
            class="submit"
            type="submit"
            :disabled="addingTag || linkingId.length > 0"
          >
            {{ addingTag || linkingId ? '추가 중' : '추가' }}
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
          >
            <span class="memo-tag-name">{{ tag.name }}</span>
            <button
              class="memo-tag-remove"
              type="button"
              :aria-label="`${tag.name} 삭제`"
              :disabled="unlinkingId === tag.id"
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
