<script setup lang="ts">
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { isNewMemoBody } from '~/utils/new-memo'

const props = defineProps<{
  markdown: string
}>()

const emit = defineEmits<{
  baseline: [markdown: string]
  draft: [markdown: string]
}>()

const editor = shallowRef<Editor>()

const tools = [
  {
    label: '굵게',
    active: () => editor.value?.isActive('bold') ?? false,
    run: () => editor.value?.chain().focus().toggleBold().run(),
  },
  {
    label: '기울임',
    active: () => editor.value?.isActive('italic') ?? false,
    run: () => editor.value?.chain().focus().toggleItalic().run(),
  },
  {
    label: '제목',
    active: () => editor.value?.isActive('heading', { level: 2 }) ?? false,
    run: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: '목록',
    active: () => editor.value?.isActive('bulletList') ?? false,
    run: () => editor.value?.chain().focus().toggleBulletList().run(),
  },
  {
    label: '번호',
    active: () => editor.value?.isActive('orderedList') ?? false,
    run: () => editor.value?.chain().focus().toggleOrderedList().run(),
  },
  {
    label: '인용',
    active: () => editor.value?.isActive('blockquote') ?? false,
    run: () => editor.value?.chain().focus().toggleBlockquote().run(),
  },
  {
    label: '코드',
    active: () => editor.value?.isActive('code') ?? false,
    run: () => editor.value?.chain().focus().toggleCode().run(),
  },
]

onMounted(() => {
  const instance = new Editor({
    editable: true,
    content: props.markdown,
    contentType: 'markdown',
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({
        placeholder: '내용을 입력하세요',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'memo-wysiwyg',
        'aria-label': '메모 본문',
      },
    },
    onUpdate: ({ editor: current }) => {
      emit('draft', current.getMarkdown())
    },
  })
  editor.value = instance
  if (isNewMemoBody(props.markdown)) {
    const first = instance.state.doc.firstChild
    if (first && first.content.size > 0) {
      instance.chain().setTextSelection({ from: 1, to: 1 + first.content.size }).focus().run()
    }
  }
  emit('baseline', instance.getMarkdown())
})

function replaceMarkdown(markdown: string): string {
  const instance = editor.value
  if (!instance) {
    throw new Error('편집기가 없습니다.')
  }
  instance.commands.setContent(markdown, {
    contentType: 'markdown',
    emitUpdate: false,
  })
  return instance.getMarkdown()
}

defineExpose({ replaceMarkdown })

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="memo-editor">
    <div
      v-if="editor"
      class="memo-tools"
      role="toolbar"
      aria-label="서식"
    >
      <button
        v-for="tool in tools"
        :key="tool.label"
        class="memo-tool"
        type="button"
        :aria-pressed="tool.active()"
        @mousedown.prevent
        @click="tool.run()"
      >
        {{ tool.label }}
      </button>
    </div>
    <EditorContent
      v-if="editor"
      :editor="editor"
    />
    <p
      v-else
      class="lead"
    >
      편집기를 준비하는 중
    </p>
  </div>
</template>
