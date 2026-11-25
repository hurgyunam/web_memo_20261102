<script setup lang="ts">
import type { FilterItem } from '~/types/filter'
import type { TagItem } from '~/types/tag'
import { filterOverlapMessage, hasTagOverlap } from '~/utils/filter-condition'

useHead({ title: '필터 · 메모' })

const nuxtApp = useNuxtApp()
const includeIds = ref<string[]>([])
const excludeIds = ref<string[]>([])
const keyword = ref('')
const filterName = ref('')
const saving = ref(false)
const message = ref('')
const notice = ref('')

const { data: tagData, error: tagError, pending: tagsPending } = await useFetch<{ tags: TagItem[] }>('/api/tags', {
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const { data: filterData, error: filterError, pending: filtersPending, refresh } = await useFetch<{ filters: FilterItem[] }>('/api/filters', {
  getCachedData(key) {
    if (nuxtApp.isHydrating) {
      return nuxtApp.payload.data[key]
    }
  },
})

const tags = computed(() => tagData.value?.tags ?? [])
const filters = computed(() => filterData.value?.filters ?? [])
const loadError = computed(() => {
  if (message.value) {
    return ''
  }
  if (tagError.value) {
    return accountErrorMessage(tagError.value, '태그 목록을 불러오지 못했습니다.')
  }
  if (filterError.value) {
    return accountErrorMessage(filterError.value, '필터 목록을 불러오지 못했습니다.')
  }
  return ''
})

function tagLabel(items: { name: string }[]): string {
  return items.length > 0 ? items.map((item) => item.name).join(', ') : '없음'
}

function keywordLabel(value: string): string {
  return value ? `키워드 “${value}”` : '키워드 없음'
}

function summary(filter: FilterItem): string {
  return `포함 ${tagLabel(filter.includeTags)} · 제외 ${tagLabel(filter.excludeTags)} · ${keywordLabel(filter.keyword)}`
}

async function viewMemos() {
  message.value = ''
  notice.value = ''
  if (hasTagOverlap(includeIds.value, excludeIds.value)) {
    message.value = filterOverlapMessage
    return
  }
  const query: Record<string, string> = {}
  if (includeIds.value.length > 0) {
    query.include = includeIds.value.join(',')
  }
  if (excludeIds.value.length > 0) {
    query.exclude = excludeIds.value.join(',')
  }
  if (keyword.value) {
    query.keyword = keyword.value
  }
  await navigateTo({ path: '/memos', query })
}

async function saveFilter() {
  saving.value = true
  message.value = ''
  notice.value = ''
  try {
    await $fetch<FilterItem>('/api/filters', {
      method: 'POST',
      body: {
        name: filterName.value,
        includeTagIds: [...includeIds.value],
        excludeTagIds: [...excludeIds.value],
        keyword: keyword.value,
      },
    })
    filterName.value = ''
    notice.value = '필터를 저장했습니다.'
    await refresh()
  } catch (caught) {
    message.value = accountErrorMessage(caught, '필터를 저장하지 못했습니다.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="panel filter-panel">
    <div>
      <h1>필터</h1>
      <p class="lead">포함 태그, 제외 태그, 키워드로 이 계정의 메모를 거르고, 그 조건을 저장합니다.</p>
    </div>
    <p
      v-if="message || loadError"
      class="alert"
      role="alert"
    >
      {{ message || loadError }}
    </p>
    <p
      v-if="notice"
      class="notice"
    >
      {{ notice }}
    </p>
    <form
      class="form"
      novalidate
      @submit.prevent="viewMemos"
    >
      <div class="filter-sets">
        <fieldset class="filter-tags">
          <legend>포함 태그</legend>
          <p
            v-if="tagsPending && tags.length === 0"
            class="lead"
          >
            불러오는 중
          </p>
          <p
            v-else-if="tags.length === 0"
            class="lead"
          >
            태그가 없습니다.
          </p>
          <div
            v-else
            class="check-list"
          >
            <label
              v-for="tag in tags"
              :key="`include-${tag.id}`"
              class="check"
            >
              <input
                v-model="includeIds"
                type="checkbox"
                name="include"
                :value="tag.id"
              >
              <span>{{ tag.name }}</span>
            </label>
          </div>
        </fieldset>
        <fieldset class="filter-tags">
          <legend>제외 태그</legend>
          <p
            v-if="tagsPending && tags.length === 0"
            class="lead"
          >
            불러오는 중
          </p>
          <p
            v-else-if="tags.length === 0"
            class="lead"
          >
            태그가 없습니다.
          </p>
          <div
            v-else
            class="check-list"
          >
            <label
              v-for="tag in tags"
              :key="`exclude-${tag.id}`"
              class="check"
            >
              <input
                v-model="excludeIds"
                type="checkbox"
                name="exclude"
                :value="tag.id"
              >
              <span>{{ tag.name }}</span>
            </label>
          </div>
        </fieldset>
      </div>
      <label class="field">
        <span>키워드</span>
        <input
          v-model="keyword"
          type="text"
          name="keyword"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
      <button
        class="submit"
        type="submit"
      >
        메모 보기
      </button>
    </form>
    <form
      class="form"
      novalidate
      @submit.prevent="saveFilter"
    >
      <label class="field">
        <span>필터 이름</span>
        <input
          v-model="filterName"
          type="text"
          name="name"
          autocomplete="off"
          spellcheck="false"
        >
      </label>
      <button
        class="submit"
        type="submit"
        :disabled="saving"
      >
        {{ saving ? '저장 중' : '저장' }}
      </button>
    </form>
    <h2>저장된 필터</h2>
    <p
      v-if="filtersPending && filters.length === 0 && !filterError"
      class="lead"
    >
      불러오는 중
    </p>
    <p
      v-else-if="filters.length === 0 && !filterError"
      class="lead"
    >
      저장된 필터가 없습니다.
    </p>
    <ul
      v-else-if="filters.length > 0"
      class="filter-list"
    >
      <li
        v-for="filter in filters"
        :key="filter.id"
      >
        <NuxtLink
          class="filter-link"
          :to="{ path: '/memos', query: { filter: filter.id } }"
        >
          <span class="filter-name">{{ filter.name }}</span>
          <span class="filter-summary">{{ summary(filter) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
