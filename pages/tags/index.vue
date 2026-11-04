<script setup lang="ts">
import type { TagItem } from '~/types/tag'

useHead({ title: '태그 · 메모' })

const nuxtApp = useNuxtApp()
const name = ref('')
const adding = ref(false)
const message = ref('')
const editingId = ref('')
const draft = ref('')
const savingId = ref('')
const deletingId = ref('')

const { data, error, pending, refresh } = await useFetch<{ tags: TagItem[] }>('/api/tags', {
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const tags = computed(() => data.value?.tags ?? [])
const loadError = computed(() => error.value
  ? accountErrorMessage(error.value, '태그 목록을 불러오지 못했습니다.')
  : '')

async function addTag() {
  adding.value = true
  message.value = ''
  try {
    await $fetch<TagItem>('/api/tags', {
      method: 'POST',
      body: { name: name.value },
    })
    name.value = ''
    await refresh()
  } catch (caught) {
    message.value = accountErrorMessage(caught, '태그를 추가하지 못했습니다.')
  } finally {
    adding.value = false
  }
}

async function startEdit(tag: TagItem) {
  editingId.value = tag.id
  draft.value = tag.name
  message.value = ''
  await nextTick()
  const field = document.getElementById('tag-name-draft')
  if (field instanceof HTMLInputElement) {
    field.focus()
  }
}

function cancelEdit() {
  editingId.value = ''
  draft.value = ''
}

async function saveName(tag: TagItem) {
  savingId.value = tag.id
  message.value = ''
  try {
    await $fetch<TagItem>(`/api/tags/${tag.id}`, {
      method: 'PUT',
      body: { name: draft.value },
    })
    editingId.value = ''
    draft.value = ''
    await refresh()
  } catch (caught) {
    message.value = accountErrorMessage(caught, '태그 이름을 바꾸지 못했습니다.')
  } finally {
    savingId.value = ''
  }
}

async function removeTag(tag: TagItem) {
  deletingId.value = tag.id
  message.value = ''
  try {
    await $fetch(`/api/tags/${tag.id}`, { method: 'DELETE' })
    if (editingId.value === tag.id) {
      cancelEdit()
    }
    await refresh()
  } catch (caught) {
    message.value = accountErrorMessage(caught, '태그를 삭제하지 못했습니다.')
  } finally {
    deletingId.value = ''
  }
}
</script>

<template>
  <section class="panel tag-panel">
    <div>
      <h1>태그</h1>
      <p class="lead">이 계정의 태그를 추가하고, 이름을 바꾸거나 삭제합니다.</p>
    </div>
    <p
      v-if="loadError || message"
      class="alert"
      role="alert"
    >
      {{ message || loadError }}
    </p>
    <form
      class="form"
      novalidate
      @submit.prevent="addTag"
    >
      <label class="field">
        <span>이름</span>
        <input
          v-model="name"
          type="text"
          name="name"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="adding"
      >
        {{ adding ? '추가 중' : '추가' }}
      </button>
    </form>
    <p
      v-if="pending && tags.length === 0 && !loadError"
      class="lead"
    >
      불러오는 중
    </p>
    <p
      v-else-if="tags.length === 0 && !loadError"
      class="lead"
    >
      태그가 없습니다.
    </p>
    <ul
      v-else-if="tags.length > 0"
      class="tag-list"
    >
      <li
        v-for="tag in tags"
        :key="tag.id"
        class="tag-row"
      >
        <form
          v-if="editingId === tag.id"
          class="tag-edit"
          novalidate
          @submit.prevent="saveName(tag)"
        >
          <label class="field">
            <span>새 이름</span>
            <input
              id="tag-name-draft"
              v-model="draft"
              type="text"
              :name="`name-${tag.id}`"
              autocomplete="off"
              spellcheck="false"
            >
          </label>
          <div class="tag-actions">
            <button
              class="submit"
              type="submit"
              :disabled="savingId === tag.id"
            >
              {{ savingId === tag.id ? '저장 중' : '저장' }}
            </button>
            <button
              class="quiet"
              type="button"
              :disabled="savingId === tag.id"
              @click="cancelEdit"
            >
              취소
            </button>
          </div>
        </form>
        <div
          v-else
          class="tag-row-main"
        >
          <span class="tag-name">{{ tag.name }}</span>
          <div class="tag-actions">
            <button
              class="quiet"
              type="button"
              @click="startEdit(tag)"
            >
              이름 수정
            </button>
            <button
              class="danger"
              type="button"
              :aria-label="`${tag.name} 삭제`"
              :disabled="deletingId === tag.id"
              @click="removeTag(tag)"
            >
              {{ deletingId === tag.id ? '삭제 중' : '삭제' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
