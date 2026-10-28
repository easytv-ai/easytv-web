<script setup lang="ts">
/**
 * 左侧对象树 + 添加目录（复刻自 open-director 的 ObjectTreePanel / 资源栏，MIT）。
 *
 * 左边一列图标切场景树 / 角色 / 几何体 / 机位。分组规则在 object-tree.ts。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { BODY_TYPE_OPTIONS } from '~/utils/director/body-types'
import { DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT } from '~/utils/director/camera-geometry'
import { GEOMETRY_PRIMITIVE_OPTIONS } from '~/utils/director/schema'
import type { CharacterBodyType, GeometryPrimitiveType } from '~/utils/director/schema'
import assetApi from '~/api/asset'
import {
  IMPORTED_MODEL_ACCEPT,
  importedModelFileError,
} from '~/utils/director/imported-model'
import {
  buildObjectTree,
  filterObjectTree,
  isTreeItemSelected,
  resolveSelectedIds,
  type ObjectTreeItem,
} from '~/utils/director/object-tree'

const { t } = useI18n()
const toast = useToast()
const store = useDirectorStore()

type LeftPane = 'scene' | 'character' | 'geometry' | 'camera'

const pane = ref<LeftPane>('scene')
const query = ref('')
/** 展开的群众组；默认全收起，一组几十个人摊开会把树撑爆 */
const expandedCrowdIds = ref<string[]>([])

const CROWD_PRESET = { rows: 2, columns: 3, spacing: 1 } as const

const RAIL: { id: LeftPane, icon: string, label: string }[] = [
  { id: 'scene', icon: 'i-lucide-list-tree', label: '场景对象' },
  { id: 'character', icon: 'i-lucide-person-standing', label: '添加角色' },
  { id: 'geometry', icon: 'i-lucide-box', label: '几何体' },
  { id: 'camera', icon: 'i-lucide-camera', label: '添加机位' },
]

const GEOMETRY_ICONS: Record<GeometryPrimitiveType, string> = {
  box: 'i-lucide-box',
  sphere: 'i-lucide-circle',
  cylinder: 'i-lucide-cylinder',
  torus: 'i-lucide-circle-dot',
  cone: 'i-lucide-triangle',
  pyramid: 'i-lucide-pyramid',
}

const searchPlaceholder = computed(() => {
  if (pane.value === 'character')
    return t('搜索角色')
  if (pane.value === 'geometry')
    return t('搜索几何体')
  if (pane.value === 'camera')
    return t('搜索机位')
  return t('全部场景对象')
})

const catalogQuery = computed(() => query.value.trim().toLowerCase())
/** 目录项 label 是中文原文（界面上 t() 过），搜索时原文和当前语言译文都认 */
function labelMatches(label: string) {
  const q = catalogQuery.value
  return label.toLowerCase().includes(q) || t(label).toLowerCase().includes(q)
}

const characterItems = computed(() => {
  const items = BODY_TYPE_OPTIONS.map(item => ({
    id: item.bodyType,
    label: item.label,
    icon: 'i-lucide-person-standing' as const,
  }))
  const crowd = { id: 'crowd' as const, label: '群众', icon: 'i-lucide-users' as const }
  const list = [...items, crowd]
  if (!catalogQuery.value)
    return list
  return list.filter(item => labelMatches(item.label))
})

const geometryItems = computed(() => {
  const list = GEOMETRY_PRIMITIVE_OPTIONS.map(item => ({
    type: item.type,
    label: item.label,
    icon: GEOMETRY_ICONS[item.type],
  }))
  if (!catalogQuery.value)
    return list
  return list.filter(item => labelMatches(item.label))
})

const cameraObjects = computed(() => {
  const list = store.project.value.objects.filter(item => item.kind === 'camera')
  if (!catalogQuery.value)
    return list
  return list.filter(item => item.name.toLowerCase().includes(catalogQuery.value))
})

function setPane(next: LeftPane) {
  pane.value = next
  query.value = ''
}

function addCharacterItem(id: CharacterBodyType | 'crowd') {
  if (store.readonly.value)
    return
  if (id === 'crowd') {
    store.addCrowdCharacters(CROWD_PRESET)
    return
  }
  store.addPresetCharacter(id)
}

function addGeometry(type: GeometryPrimitiveType) {
  if (store.readonly.value)
    return
  store.addGeometryPrimitive(type)
}

const fileInput = ref<HTMLInputElement | null>(null)
const importKind = ref<'prop' | 'character'>('prop')
const importing = ref(false)

function pickImportedModel(kind: 'prop' | 'character') {
  if (store.readonly.value || importing.value)
    return
  importKind.value = kind
  const input = fileInput.value
  if (!input)
    return
  input.value = ''
  input.click()
}

async function onImportedFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  const error = importedModelFileError(file)
  if (error) {
    toast.add({ title: t(error), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }

  importing.value = true
  const localUrl = URL.createObjectURL(file)
  const { assetId } = store.addImportedModel({
    url: localUrl,
    fileName: file.name,
    kind: importKind.value,
    assetSource: 'local',
  })

  try {
    const res = await assetApi.upload(file)
    const uploaded = res?.success ? String(res.data?.url || '').trim() : ''
    if (uploaded) {
      store.updateImportedAsset(assetId, { url: uploaded, assetSource: 'library' })
      URL.revokeObjectURL(localUrl)
      toast.add({ title: t('模型已保存，刷新后还能看到'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    }
    else {
      toast.add({ title: res?.message || t('模型上传失败，刷新页面后会从场景里消失'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    }
  }
  catch {
    toast.add({ title: t('模型上传失败，刷新页面后会从场景里消失'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    importing.value = false
  }
}

function addCamera() {
  if (store.readonly.value)
    return
  const index = store.project.value.cameras.length
  const { position, target, fov } = DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT
  const cameraId = store.addCameraShot({
    position: [position[0] + index * 1.4, position[1], position[2]],
    target,
    fov,
  })
  const object = store.project.value.objects.find(item => item.linkedCameraId === cameraId)
  if (object)
    store.selectObject(object.id)
}

function selectCameraObject(objectId: string) {
  store.selectObject(objectId)
}

const groups = computed(() =>
  filterObjectTree(
    buildObjectTree(store.project.value.objects, store.project.value.assets),
    query.value,
  ),
)

const noResult = computed(() => query.value.trim().length > 0 && groups.value.length === 0)

function selectedOf(item: ObjectTreeItem) {
  return isTreeItemSelected(item, store.state.value)
}

/**
 * 按住 Shift 是加选 / 减选。
 *
 * 群众组和多对象行整组处理：已经全选中就整组取消，否则把没选中的补上 ——
 * 逐个 toggle 的话，半选状态下点一次会把已选的那几个反而取消掉。
 */
function toggleGroupSelection(objectIds: string[]) {
  const selected = resolveSelectedIds(store.state.value)
  const allSelected = objectIds.every(id => selected.includes(id))

  for (const id of objectIds) {
    const selectedNow = resolveSelectedIds(store.state.value).includes(id)
    // 全选中就逐个取消，否则只补上没选中的
    if (allSelected ? selectedNow : !selectedNow)
      store.toggleObjectSelection(id)
  }
}

function onRowClick(item: ObjectTreeItem, event: MouseEvent) {
  if (event.shiftKey) {
    toggleGroupSelection(item.objectIds)
    return
  }

  if (item.crowdId) {
    store.selectCrowd(item.crowdId)
    return
  }

  // 机位不特殊处理：selectObject 自己会把它设成当前机位（withLinkedCamera），
  // 上游在这里提前 return 只切机位不选中，结果点了机位右侧面板还停在上一个对象上
  store.selectObject(item.id)
}

/** 点群众组里的某个成员：单选它本人，方便单独调姿势 */
function onChildClick(childId: string, event: MouseEvent) {
  if (event.shiftKey) {
    store.toggleObjectSelection(childId)
    return
  }
  store.selectObject(childId)
}

function toggleExpanded(crowdId: string) {
  expandedCrowdIds.value = expandedCrowdIds.value.includes(crowdId)
    ? expandedCrowdIds.value.filter(id => id !== crowdId)
    : [...expandedCrowdIds.value, crowdId]
}

function toggleVisible(ids: string[]) {
  if (store.readonly.value)
    return
  store.toggleObjectsVisible(ids)
}

function toggleLocked(ids: string[]) {
  if (store.readonly.value)
    return
  store.toggleObjectsLocked(ids)
}

function objectLocked(id: string) {
  return Boolean(store.project.value.objects.find(item => item.id === id)?.locked)
}

function unlockedIds(ids: string[]) {
  return ids.filter(id => !objectLocked(id))
}

function removeObjects(ids: string[]) {
  if (store.readonly.value)
    return
  const unlocked = unlockedIds(ids)
  if (!unlocked.length) {
    toast.add({ title: t('canvas.lock.lock'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  store.deleteObjects(unlocked)
}

/** 焦点在输入框里时 Delete 是删字符，不是删对象 */
function isEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
    return
  if (event.key !== 'Delete' && event.key !== 'Backspace')
    return
  if (isEditingTarget(event.target))
    return
  if (!resolveSelectedIds(store.state.value).length)
    return
  if (store.readonly.value)
    return
  const unlocked = unlockedIds(resolveSelectedIds(store.state.value))
  if (!unlocked.length)
    return

  event.preventDefault()
  store.deleteObjects(unlocked)
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <section class="director-panel director-tree" :aria-label="t('场景对象')">
    <nav class="director-tree__rail" :aria-label="t('添加对象')">
      <button
        v-for="item in RAIL"
        :key="item.id"
        type="button"
        :class="{ 'is-on': pane === item.id }"
        :aria-label="t(item.label)"
        @click="setPane(item.id)"
      >
        <UIcon :name="item.icon" class="size-4" />
        <span class="canvas-tip">{{ t(item.label) }}</span>
      </button>
    </nav>

    <div class="director-tree__main">
      <div class="director-tree__search">
        <UIcon name="i-lucide-search" class="size-3.5" />
        <input
          type="text"
          :aria-label="searchPlaceholder"
          :placeholder="searchPlaceholder"
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value"
        >
      </div>

      <input
        ref="fileInput"
        type="file"
        class="sr-only"
        :accept="IMPORTED_MODEL_ACCEPT"
        @change="onImportedFile"
      >

      <template v-if="pane === 'character'">
        <h3 class="director-catalog__title">{{ t('添加角色') }}</h3>
        <ul class="director-catalog" :aria-label="t('添加角色')">
          <li>
            <button
              type="button"
              class="director-row director-catalog__row"
              :disabled="importing || store.readonly.value"
              @click="pickImportedModel('character')"
            >
              <UIcon class="director-row__kind size-4" name="i-lucide-upload" />
              <span class="director-row__name">{{ importing ? t('导入中…') : t('导入角色模型') }}</span>
            </button>
          </li>
          <li class="director-catalog__hint">{{ t('支持 GLB / GLTF，保存时会上传到资产库') }}</li>
          <li v-for="item in characterItems" :key="item.id">
            <button
              type="button"
              class="director-row director-catalog__row"
              :disabled="store.readonly.value"
              @click="addCharacterItem(item.id)"
            >
              <UIcon class="director-row__kind size-4" :name="item.icon" />
              <span class="director-row__name">{{ t(item.label) }}</span>
              <UIcon v-if="item.id === 'crowd'" name="i-lucide-chevron-right" class="size-3.5 director-catalog__more" />
            </button>
          </li>
        </ul>
      </template>

      <template v-else-if="pane === 'geometry'">
        <h3 class="director-catalog__title">{{ t('几何体') }}</h3>
        <ul class="director-catalog" :aria-label="t('几何体')">
          <li>
            <button
              type="button"
              class="director-row director-catalog__row"
              :disabled="importing || store.readonly.value"
              @click="pickImportedModel('prop')"
            >
              <UIcon class="director-row__kind size-4" name="i-lucide-upload" />
              <span class="director-row__name">{{ importing ? t('导入中…') : t('导入模型') }}</span>
            </button>
          </li>
          <li class="director-catalog__hint">{{ t('支持 GLB / GLTF，保存时会上传到资产库') }}</li>
          <li v-for="item in geometryItems" :key="item.type">
            <button
              type="button"
              class="director-row director-catalog__row"
              :disabled="store.readonly.value"
              @click="addGeometry(item.type)"
            >
              <UIcon class="director-row__kind size-4" :name="item.icon" />
              <span class="director-row__name">{{ t(item.label) }}</span>
            </button>
          </li>
        </ul>
      </template>

      <template v-else-if="pane === 'camera'">
        <ul class="director-catalog" :aria-label="t('摄像机')">
          <li>
            <button
              type="button"
              class="director-row director-catalog__row"
              :disabled="store.readonly.value"
              @click="addCamera()"
            >
              <UIcon class="director-row__kind size-4" name="i-lucide-circle-plus" />
              <span class="director-row__name">{{ t('添加机位') }}</span>
            </button>
          </li>
          <li v-for="item in cameraObjects" :key="item.id">
            <button
              type="button"
              class="director-row director-catalog__row"
              :class="{ 'is-selected': store.state.value.selectedObjectId === item.id || store.project.value.activeCameraId === item.linkedCameraId }"
              @click="selectCameraObject(item.id)"
            >
              <UIcon class="director-row__kind size-4" name="i-lucide-camera" />
              <span class="director-row__name">{{ item.name }}</span>
            </button>
          </li>
        </ul>
      </template>

      <div v-else-if="noResult" class="director-tree__empty" role="status">
        <UIcon name="i-lucide-search" class="size-4.5" />
        <span>{{ t('未搜索到内容') }}</span>
      </div>

      <div v-else class="director-tree__groups" role="tree" :aria-label="t('场景对象列表')">
      <section
        v-for="group in groups"
        :key="group.key"
        class="director-tree__group"
        role="group"
        :aria-label="t(group.title)"
      >
        <h3>{{ t(group.title) }}</h3>
        <ul>
          <li v-for="item in group.items" :key="item.id">
            <div
              class="director-row"
              :class="{ 'is-selected': selectedOf(item) }"
              role="treeitem"
              :aria-label="item.name"
              :aria-selected="selectedOf(item)"
              @click="onRowClick(item, $event)"
            >
              <button
                v-if="item.crowdId"
                type="button"
                class="director-row__toggle"
                :aria-label="`${expandedCrowdIds.includes(item.crowdId) ? t('收起') : t('展开')} ${item.name}`"
                @click.stop="toggleExpanded(item.crowdId)"
              >
                <UIcon :name="expandedCrowdIds.includes(item.crowdId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
              </button>

              <UIcon class="director-row__kind size-4" :name="item.icon" />
              <span class="director-row__name">{{ item.name }}</span>

              <button
                type="button"
                class="director-row__flag"
                :class="{ 'is-off': !item.visible }"
                :disabled="store.readonly.value"
                :aria-label="`${item.name} ${t('可见性')}`"
                @click.stop="toggleVisible(item.objectIds)"
              >
                <UIcon :name="item.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'" class="size-3.5" />
              </button>
              <button
                type="button"
                class="director-row__flag"
                :class="{ 'is-on': item.locked }"
                :disabled="store.readonly.value"
                :aria-label="`${item.name} ${t('锁定')}`"
                @click.stop="toggleLocked(item.objectIds)"
              >
                <UIcon :name="item.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-3.5" />
              </button>
              <button
                type="button"
                class="director-row__flag director-row__flag--danger"
                :disabled="store.readonly.value || item.locked"
                :aria-label="`${item.name} ${t('删除')}`"
                :title="item.locked ? t('canvas.lock.lock') : undefined"
                @click.stop="removeObjects(item.objectIds)"
              >
                <UIcon name="i-lucide-trash-2" class="size-3.5" />
              </button>
            </div>

            <ul
              v-if="item.crowdId && expandedCrowdIds.includes(item.crowdId) && item.children?.length"
              class="director-row__children"
              :aria-label="`${item.name} ${t('成员')}`"
            >
              <li v-for="child in item.children" :key="child.id">
                <div
                  class="director-row director-row--child"
                  :class="{ 'is-selected': store.state.value.selectedObjectId === child.id }"
                  role="treeitem"
                  :aria-label="child.name"
                  :aria-selected="store.state.value.selectedObjectId === child.id"
                  @click="onChildClick(child.id, $event)"
                >
                  <UIcon class="director-row__kind size-4" :name="child.icon" />
                  <span class="director-row__name">{{ child.name }}</span>
                  <button
                    type="button"
                    class="director-row__flag"
                    :class="{ 'is-off': !child.visible }"
                    :disabled="store.readonly.value"
                    :aria-label="`${child.name} ${t('可见性')}`"
                    @click.stop="toggleVisible([child.id])"
                  >
                    <UIcon :name="child.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'" class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="director-row__flag"
                    :class="{ 'is-on': child.locked }"
                    :disabled="store.readonly.value"
                    :aria-label="`${child.name} ${t('锁定')}`"
                    @click.stop="toggleLocked([child.id])"
                  >
                    <UIcon :name="child.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="director-row__flag director-row__flag--danger"
                    :disabled="store.readonly.value || child.locked"
                    :aria-label="`${child.name} ${t('删除')}`"
                    :title="child.locked ? t('canvas.lock.lock') : undefined"
                    @click.stop="removeObjects([child.id])"
                  >
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                </div>
              </li>
            </ul>
          </li>
        </ul>
      </section>
    </div>
    </div>
  </section>
</template>
