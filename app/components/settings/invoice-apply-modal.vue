<script setup lang="ts">
/**
 * 申请开票弹框：抬头类型 → 抬头（企业抬头托管在发票平台）→ 票种 → 邮箱 / 备注 → POST /user/invoice/apply
 */
import { invoiceApi, type InvoiceCompanyPayload, type InvoicePlatform, type InvoiceSummary } from '~/api/invoice'
import {
  INVOICE_REMARK_MAX,
  formatInvoiceMoney,
  isInvoiceNoData,
  isSpecialInvoiceCategory,
  mapCompanySuggestion,
  mapInvoiceCompany,
  parseInvoiceCategories,
  pickDefaultCompanyId,
  platformList,
  validateInvoiceApply,
  validateInvoiceCompany,
  type InvoiceApplyBody,
  type InvoiceCompany,
  type InvoiceCompanySuggestion,
  type InvoiceTitleType,
} from '~/utils/invoice'

const props = defineProps<{
  open: boolean
  amount: number
  summary: InvoiceSummary
  platform: InvoicePlatform
  defaultEmail?: string
}>()

const emit = defineEmits<{
  close: []
  submitted: [outOrderNo: string]
}>()

const { t } = useI18n()
const toast = useToast()
const { confirm, state: confirmState } = useConfirm()

function notify(title: string, color: 'neutral' | 'error' | 'success' | 'warning' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const titleType = ref<InvoiceTitleType>('企业')
const personalName = ref('')
const category = ref('')
const email = ref('')
const remark = ref('')
const submitting = ref(false)
const formError = ref('')

const TYPE_OPTIONS: { value: InvoiceTitleType, label: string, icon: string }[] = [
  { value: '企业', label: '企业', icon: 'i-lucide-building-2' },
  { value: '个人', label: '个人', icon: 'i-lucide-user-round' },
]

/* ── 票种 ── */
const categories = ref<string[]>([])
const categoriesLoading = ref(false)
const categoriesError = ref(false)

async function loadCategories() {
  categoriesLoading.value = true
  categoriesError.value = false
  try {
    const res = await props.platform.categories()
    if (res.code !== 1 && !isInvoiceNoData(res)) {
      categoriesError.value = categories.value.length === 0
      notify(res.message || t('加载失败，请稍后重试'), 'error')
      return
    }
    let list = res.code === 1 ? parseInvoiceCategories(res) : []
    if (!list.length && props.summary.category)
      list = [props.summary.category]
    categories.value = list
    categoriesError.value = false
    if (!list.includes(category.value)) {
      const fallback = props.summary.category
      category.value = fallback && list.includes(fallback) ? fallback : (list[0] ?? '')
    }
  }
  finally {
    categoriesLoading.value = false
  }
}

const needsTaxNumber = computed(() => isSpecialInvoiceCategory(category.value))

/* ── 企业抬头 ── */
const companies = ref<InvoiceCompany[]>([])
const companiesLoading = ref(false)
const companiesError = ref(false)
const selectedCompanyId = ref<number | null>(null)
const selectedCompany = computed(() => companies.value.find(c => c.id === selectedCompanyId.value) ?? null)

async function loadCompanies() {
  companiesLoading.value = true
  companiesError.value = false
  try {
    const res = await props.platform.companies()
    if (res.code !== 1 && !isInvoiceNoData(res)) {
      companiesError.value = true
      notify(res.message || t('发票抬头加载失败，请稍后重试'), 'error')
      return
    }
    companies.value = res.code === 1 ? platformList(res).map(mapInvoiceCompany) : []
    selectedCompanyId.value = pickDefaultCompanyId(companies.value, selectedCompanyId.value)
    if (!companies.value.length && titleType.value === '企业')
      openCompanyForm()
  }
  finally {
    companiesLoading.value = false
  }
}

type CompanyForm = Omit<InvoiceCompany, 'id'> & { id: number }
function emptyCompanyForm(): CompanyForm {
  return { id: 0, name: '', taxNumber: '', address: '', phone: '', bank: '', bankAccount: '', ifDefault: true }
}
const companyFormOpen = ref(false)
const companyForm = reactive<CompanyForm>(emptyCompanyForm())
const companySaving = ref(false)
const companyFormError = ref('')

function openCompanyForm(src?: InvoiceCompany) {
  Object.assign(companyForm, emptyCompanyForm(), src ?? {})
  if (!src && companies.value.length)
    companyForm.ifDefault = false
  companyFormError.value = ''
  closeSuggest()
  companyFormOpen.value = true
}

function closeCompanyForm() {
  companyFormOpen.value = false
  closeSuggest()
}

async function saveCompany() {
  const err = validateInvoiceCompany(companyForm)
  if (err) {
    companyFormError.value = t(err)
    return
  }
  const payload: InvoiceCompanyPayload = {
    name: companyForm.name.trim(),
    taxNumber: companyForm.taxNumber.trim(),
    address: companyForm.address.trim() || undefined,
    phone: companyForm.phone.trim() || undefined,
    bank: companyForm.bank.trim() || undefined,
    bankAccount: companyForm.bankAccount.trim() || undefined,
    ifDefault: companyForm.ifDefault,
  }
  const editingId = companyForm.id
  companySaving.value = true
  companyFormError.value = ''
  try {
    const res = editingId
      ? await props.platform.updateCompany(editingId, payload)
      : await props.platform.createCompany(payload)
    if (res.code !== 1) {
      companyFormError.value = res.message || t('抬头保存失败，请稍后重试')
      return
    }
    notify(editingId ? t('抬头已更新') : t('抬头已添加'), 'success')
    companyFormOpen.value = false
    const createdId = !editingId ? Number((res.content as any)?.companyId ?? (res.content as any)?.id ?? 0) : 0
    if (editingId)
      selectedCompanyId.value = editingId
    await loadCompanies()
    if (!editingId) {
      const hit = (createdId && companies.value.find(c => c.id === createdId))
        || companies.value.find(c => c.name === payload.name && c.taxNumber === payload.taxNumber)
      if (hit)
        selectedCompanyId.value = hit.id
    }
  }
  finally {
    companySaving.value = false
  }
}

async function removeCompany(c: InvoiceCompany) {
  const ok = await confirm({
    title: t('删除抬头'),
    message: t('确定删除抬头「{name}」吗？', { name: c.name }),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok)
    return
  const res = await props.platform.deleteCompany(c.id)
  if (res.code !== 1) {
    notify(res.message || t('抬头删除失败，请稍后重试'), 'error')
    return
  }
  notify(t('抬头已删除'), 'success')
  if (selectedCompanyId.value === c.id)
    selectedCompanyId.value = null
  if (companyForm.id === c.id)
    closeCompanyForm()
  await loadCompanies()
}

/* ── 企业名称联想（≥4 个字，500ms 防抖，输入法组合中不查） ── */
const suggestions = ref<InvoiceCompanySuggestion[]>([])
const suggestOpen = ref(false)
const suggestLoading = ref(false)
let suggestTimer: ReturnType<typeof setTimeout> | null = null
let suggestSeq = 0
let composing = false

function closeSuggest() {
  if (suggestTimer) {
    clearTimeout(suggestTimer)
    suggestTimer = null
  }
  suggestSeq++
  suggestions.value = []
  suggestOpen.value = false
  suggestLoading.value = false
}

async function searchCompany(name: string) {
  const keyword = name.trim()
  const seq = ++suggestSeq
  if (keyword.length < 4) {
    suggestions.value = []
    suggestOpen.value = false
    return
  }
  suggestLoading.value = true
  try {
    const res = await props.platform.companyCodes(keyword)
    if (seq !== suggestSeq)
      return
    suggestions.value = res.code === 1
      ? platformList(res).map(mapCompanySuggestion).filter(s => s.name).slice(0, 20)
      : []
    suggestOpen.value = suggestions.value.length > 0
  }
  finally {
    if (seq === suggestSeq)
      suggestLoading.value = false
  }
}

function scheduleSearch(delay = 500) {
  if (suggestTimer)
    clearTimeout(suggestTimer)
  suggestTimer = setTimeout(() => {
    suggestTimer = null
    void searchCompany(companyForm.name)
  }, delay)
}

function onNameInput() {
  if (!composing)
    scheduleSearch()
}

function onCompositionStart() {
  composing = true
  if (suggestTimer) {
    clearTimeout(suggestTimer)
    suggestTimer = null
  }
}

function onCompositionEnd(event: CompositionEvent) {
  composing = false
  companyForm.name = (event.target as HTMLInputElement).value
  scheduleSearch()
}

function pickSuggestion(s: InvoiceCompanySuggestion) {
  companyForm.name = s.name
  if (s.taxNumber)
    companyForm.taxNumber = s.taxNumber
  if (s.bank)
    companyForm.bank = s.bank
  if (s.bankAccount)
    companyForm.bankAccount = s.bankAccount
  if (s.address)
    companyForm.address = s.address
  if (s.phone)
    companyForm.phone = s.phone
  closeSuggest()
}

function onNameBlur() {
  setTimeout(() => {
    suggestOpen.value = false
  }, 150)
}

/* ── 提交 ── */
function buildBody(): InvoiceApplyBody {
  const enterprise = titleType.value === '企业'
  const c = enterprise ? selectedCompany.value : null
  return {
    amount: props.amount,
    type: titleType.value,
    category: category.value,
    email: email.value.trim(),
    purchaser_name: enterprise ? (c?.name ?? '') : personalName.value.trim(),
    purchaser_taxpayer_number: c?.taxNumber ?? '',
    purchaser_address: c?.address ?? '',
    purchaser_phone: c?.phone ?? '',
    purchaser_bank: c?.bank ?? '',
    purchaser_bank_account: c?.bankAccount ?? '',
    remark: remark.value.trim(),
  }
}

async function submit() {
  if (submitting.value)
    return
  if (titleType.value === '企业' && companyFormOpen.value && !selectedCompany.value) {
    formError.value = t('请先保存企业抬头')
    return
  }
  const body = buildBody()
  const err = validateInvoiceApply(body)
  if (err) {
    formError.value = t(err)
    return
  }
  formError.value = ''
  submitting.value = true
  try {
    const res = await invoiceApi.apply(body)
    if (!res?.success) {
      formError.value = String(res?.message || t('开票申请提交失败，请稍后重试'))
      return
    }
    remark.value = ''
    personalName.value = ''
    emit('submitted', String(res.data?.out_order_no ?? ''))
  }
  finally {
    submitting.value = false
  }
}

function close() {
  if (submitting.value)
    return
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !companySaving.value && !confirmState.value.open)
    close()
}

watch(() => props.open, (open) => {
  if (!open) {
    closeCompanyForm()
    return
  }
  formError.value = ''
  if (!email.value)
    email.value = props.defaultEmail ?? ''
  void loadCategories()
  void loadCompanies()
})

watch(titleType, () => {
  formError.value = ''
  closeSuggest()
})

watch([selectedCompanyId, category, personalName, email], () => {
  formError.value = ''
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  closeSuggest()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask invoice-apply-mask" @click.self="close">
      <div class="studio-modal publish-modal invoice-apply" role="dialog" aria-modal="true" aria-labelledby="invoice-apply-title">
        <header class="asset-picker__head invoice-apply__head">
          <div>
            <h2 id="invoice-apply-title">{{ t('申请开票') }}</h2>
            <p>{{ t('电子发票开出后发送到填写的邮箱') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="close">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="invoice-apply__body">
          <div class="invoice-apply__amount">
            <span>{{ t('开票金额') }}</span>
            <strong>{{ formatInvoiceMoney(amount) }}</strong>
          </div>

          <!-- 抬头类型 -->
          <div class="invoice-apply__section">
            <p class="invoice-apply__label">{{ t('抬头类型') }}</p>
            <div class="invoice-choices">
              <button
                v-for="opt in TYPE_OPTIONS"
                :key="opt.value"
                type="button"
                class="invoice-choice"
                :class="{ 'is-on': titleType === opt.value }"
                :aria-pressed="titleType === opt.value"
                @click="titleType = opt.value"
              >
                <UIcon :name="opt.icon" class="size-4" />
                {{ t(opt.label) }}
              </button>
            </div>
          </div>

          <!-- 个人抬头 -->
          <label v-if="titleType === '个人'" class="publish-field">
            <span>{{ t('抬头名称') }} <i>*</i></span>
            <input v-model="personalName" maxlength="100" :placeholder="t('填写个人姓名')">
          </label>

          <!-- 企业抬头 -->
          <div v-else class="invoice-apply__section">
            <div class="invoice-apply__label-row">
              <p class="invoice-apply__label">{{ t('发票抬头') }}</p>
              <button v-if="!companyFormOpen" type="button" class="settings-link" @click="openCompanyForm()">
                {{ t('添加抬头') }}
              </button>
            </div>

            <p v-if="companiesLoading && !companies.length" class="invoice-apply__placeholder">{{ t('加载中…') }}</p>
            <div v-else-if="companiesError && !companies.length" class="invoice-apply__placeholder">
              <p>{{ t('发票抬头加载失败，请稍后重试') }}</p>
              <button type="button" class="settings-link" @click="loadCompanies()">{{ t('重试') }}</button>
            </div>
            <p v-else-if="!companies.length && !companyFormOpen" class="invoice-apply__placeholder">{{ t('还没有保存的抬头，先添加一个') }}</p>
            <ul v-else-if="companies.length" class="invoice-companies" role="radiogroup" :aria-label="t('发票抬头')">
              <li
                v-for="c in companies"
                :key="c.id"
                class="invoice-company"
                :class="{ 'is-on': selectedCompanyId === c.id }"
                role="radio"
                :aria-checked="selectedCompanyId === c.id"
                tabindex="0"
                @click="selectedCompanyId = c.id"
                @keydown.enter.prevent="selectedCompanyId = c.id"
                @keydown.space.prevent="selectedCompanyId = c.id"
              >
                <UIcon :name="selectedCompanyId === c.id ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" class="invoice-company__radio size-4" />
                <div class="invoice-company__main">
                  <strong>
                    <span>{{ c.name }}</span>
                    <em v-if="c.ifDefault">{{ t('默认') }}</em>
                  </strong>
                  <small>{{ c.taxNumber || t('未填写税号') }}</small>
                </div>
                <div class="invoice-company__tools">
                  <button type="button" class="trash-modal__close" :aria-label="t('编辑')" @click.stop="openCompanyForm(c)">
                    <UIcon name="i-lucide-pencil" class="size-3.5" />
                  </button>
                  <button type="button" class="trash-modal__close is-danger" :aria-label="t('删除')" @click.stop="removeCompany(c)">
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                </div>
              </li>
            </ul>

            <!-- 抬头新增 / 编辑 -->
            <div v-if="companyFormOpen" class="invoice-company-form">
              <p class="invoice-apply__label">{{ companyForm.id ? t('编辑抬头') : t('添加抬头') }}</p>
              <div class="invoice-company-form__grid">
                <div class="publish-field is-wide">
                  <span>{{ t('抬头名称') }} <i>*</i></span>
                  <div class="invoice-suggest">
                    <input
                      v-model="companyForm.name"
                      maxlength="100"
                      :aria-label="t('抬头名称')"
                      autocomplete="off"
                      :placeholder="t('输入企业名称，4 个字以上自动联想')"
                      @input="onNameInput"
                      @compositionstart="onCompositionStart"
                      @compositionend="onCompositionEnd"
                      @focus="suggestOpen = suggestions.length > 0"
                      @blur="onNameBlur"
                    >
                    <UIcon v-if="suggestLoading" name="i-lucide-loader-circle" class="invoice-suggest__spin size-4 animate-spin" />
                    <ul v-if="suggestOpen && suggestions.length" class="invoice-suggest__list" role="listbox">
                      <li v-for="(s, i) in suggestions" :key="`${s.taxNumber}-${i}`" role="option" :aria-selected="false">
                        <button type="button" @mousedown.prevent="pickSuggestion(s)">
                          <span>{{ s.name }}</span>
                          <small v-if="s.taxNumber">{{ s.taxNumber }}</small>
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
                <label class="publish-field is-wide">
                  <span>{{ t('税号') }} <i>*</i></span>
                  <input v-model="companyForm.taxNumber" maxlength="30" :placeholder="t('统一社会信用代码')">
                </label>
                <label class="publish-field">
                  <span>{{ t('开户银行') }}</span>
                  <input v-model="companyForm.bank" maxlength="100">
                </label>
                <label class="publish-field">
                  <span>{{ t('银行账号') }}</span>
                  <input v-model="companyForm.bankAccount" maxlength="50">
                </label>
                <label class="publish-field">
                  <span>{{ t('注册地址') }}</span>
                  <input v-model="companyForm.address" maxlength="200">
                </label>
                <label class="publish-field">
                  <span>{{ t('注册电话') }}</span>
                  <input v-model="companyForm.phone" maxlength="30">
                </label>
              </div>
              <p v-if="companyFormError" class="publish-error">{{ companyFormError }}</p>
              <div class="invoice-company-form__foot">
                <label class="publish-check">
                  <input v-model="companyForm.ifDefault" type="checkbox">
                  <span>{{ t('设为默认') }}</span>
                </label>
                <div class="invoice-company-form__actions">
                  <button type="button" class="plan-btn plan-btn--ghost" :disabled="companySaving" @click="closeCompanyForm">{{ t('取消') }}</button>
                  <button type="button" class="plan-btn plan-btn--solid" :disabled="companySaving" @click="saveCompany">
                    {{ companySaving ? t('保存中…') : t('保存抬头') }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 发票类型 -->
          <div class="invoice-apply__section">
            <p class="invoice-apply__label">{{ t('发票类型') }}</p>
            <p v-if="categoriesLoading && !categories.length" class="invoice-apply__placeholder">{{ t('加载中…') }}</p>
            <div v-else-if="categoriesError && !categories.length" class="invoice-apply__placeholder">
              <p>{{ t('加载失败，请稍后重试') }}</p>
              <button type="button" class="settings-link" @click="loadCategories()">{{ t('重试') }}</button>
            </div>
            <p v-else-if="!categories.length" class="invoice-apply__placeholder">{{ t('暂无可选的发票类型') }}</p>
            <div v-else class="invoice-choices">
              <button
                v-for="c in categories"
                :key="c"
                type="button"
                class="invoice-choice"
                :class="{ 'is-on': category === c }"
                :aria-pressed="category === c"
                @click="category = c"
              >
                <UIcon :name="category === c ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" class="size-4" />
                {{ t(c) }}
              </button>
            </div>
            <p v-if="needsTaxNumber" class="settings-hint">{{ t('专用发票需要企业抬头并填写税号') }}</p>
          </div>

          <label class="publish-field">
            <span>{{ t('接收邮箱') }} <i>*</i></span>
            <input v-model="email" type="email" maxlength="100" autocomplete="email" :placeholder="t('电子发票将发送到这个邮箱')">
          </label>

          <label class="publish-field">
            <span>{{ t('备注') }}</span>
            <textarea v-model="remark" rows="3" :maxlength="INVOICE_REMARK_MAX" :placeholder="t('选填，将打印在发票备注栏')" />
            <small class="invoice-apply__count">{{ remark.length }} / {{ INVOICE_REMARK_MAX }}</small>
          </label>

          <p v-if="formError" class="publish-error" role="alert">{{ formError }}</p>
        </div>

        <footer class="plan-confirm__actions publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="close">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="submitting || companySaving" @click="submit">
            {{ submitting ? t('提交中…') : t('提交申请') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.invoice-apply {
  display: flex;
  width: min(96vw, 620px);
  max-height: calc(100vh - 48px);
  flex-direction: column;
  color: var(--st-text);
}

.invoice-apply__head {
  padding: 22px 22px 12px;
}

.invoice-apply__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 4px 22px 16px;
  overflow-y: auto;
}

.invoice-apply__amount {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-hover);
  font-size: 13px;
}

.invoice-apply__amount span {
  color: var(--st-muted);
}

.invoice-apply__amount strong {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.invoice-apply__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.invoice-apply__label {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}

.invoice-apply__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.invoice-apply__placeholder {
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--st-border);
  border-radius: 12px;
  color: var(--st-muted);
  font-size: 13px;
  text-align: center;
}

.invoice-apply__count {
  align-self: flex-end;
  color: var(--st-muted);
  font-size: 11px;
}

.invoice-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.invoice-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-elevated);
  color: var(--st-text-soft);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.invoice-choice:hover {
  border-color: var(--st-chip-border);
}

.invoice-choice.is-on,
.invoice-company.is-on {
  border-color: var(--st-on);
  background: color-mix(in srgb, var(--st-on) 6%, var(--st-elevated));
  color: var(--st-text);
  font-weight: 600;
}

.invoice-companies {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.invoice-company {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-elevated);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.invoice-company:hover,
.invoice-company:focus-visible {
  border-color: var(--st-chip-border);
}

.invoice-company.is-on {
  font-weight: 400;
}

.invoice-company__radio {
  flex-shrink: 0;
  color: var(--st-muted);
}

.invoice-company.is-on .invoice-company__radio {
  color: var(--st-text);
}

.invoice-company__main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.invoice-company__main strong {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.invoice-company__main strong span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invoice-company__main em {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--st-plan-soft);
  color: var(--st-plan);
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
  line-height: 18px;
}

.invoice-company__main small {
  overflow: hidden;
  color: var(--st-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invoice-company__tools {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.invoice-company__tools .is-danger:hover {
  color: #dc2626;
}

.invoice-company-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-hover);
}

.invoice-company-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.invoice-company-form__grid .is-wide {
  grid-column: 1 / -1;
}

.invoice-company-form__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.invoice-company-form__actions {
  display: flex;
  gap: 8px;
}

.invoice-company-form__actions .plan-btn {
  width: auto;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13px;
}

.invoice-suggest {
  position: relative;
  display: flex;
  flex-direction: column;
}

.invoice-suggest input {
  width: 100%;
  padding-right: 34px;
}

.invoice-suggest__spin {
  position: absolute;
  top: 50%;
  right: 12px;
  color: var(--st-muted);
  transform: translateY(-50%);
}

.invoice-suggest__list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 5;
  max-height: 220px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-pop);
  box-shadow: var(--st-shadow);
  list-style: none;
}

.invoice-suggest__list button {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--st-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.invoice-suggest__list button:hover {
  background: var(--st-hover);
}

.invoice-suggest__list small {
  color: var(--st-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.invoice-apply .publish-modal__foot {
  margin-top: 0;
  padding: 12px 22px 20px;
  border-top: 1px solid var(--st-border);
}

@media (max-width: 560px) {
  .invoice-choices,
  .invoice-company-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>
