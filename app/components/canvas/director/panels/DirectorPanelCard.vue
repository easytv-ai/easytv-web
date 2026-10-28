<script setup lang="ts">
/**
 * 面板外壳（复刻自 open-director 的 InspectorPanel，MIT）。
 * 标题 + 可选的标签页 + 滚动区 + 可选的页脚。
 */
defineProps<{
  title: string
  /** 读屏标签，命名理由见 DirectorNumberInput */
  srLabel: string
  /** 不传就不画标签栏 */
  tabs?: { id: string, label: string }[]
  activeTab?: string
  /** 对象锁定或只读：冻住正文，标签还能切着看 */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:activeTab': [id: string] }>()
</script>

<template>
  <section class="director-panel" :class="{ 'is-write-blocked': disabled }" :aria-label="srLabel">
    <header class="director-panel__head">
      <h2 class="director-panel__title">{{ title }}</h2>
      <div v-if="$slots['head-extra']" class="director-panel__head-extra">
        <slot name="head-extra" />
      </div>
    </header>

    <div v-if="tabs?.length" class="director-panel__tabs" role="tablist" :aria-label="title">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="director-panel__tab"
        :class="{ 'is-active': tab.id === activeTab }"
        :aria-selected="tab.id === activeTab"
        @click="emit('update:activeTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="director-panel__body">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="director-panel__foot">
      <slot name="footer" />
    </footer>
  </section>
</template>
