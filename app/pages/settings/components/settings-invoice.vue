<script setup lang="ts">
/**
 * 设置 · 发票
 *
 * - 开启：复用已有的 InvoicePanel（额度 / 申请 / 记录 / 抬头 / 票种）
 * - 关闭：占位「暂未开放」
 * - 加载中：等 app config 拉完再决定显示哪一种
 */
import InvoicePanel from './invoice-panel.vue'

const props = defineProps<{
  invoiceEnabled: boolean
  appConfigLoaded: boolean
  appConfigLoading: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <InvoicePanel v-if="invoiceEnabled" />
  <section v-else-if="!appConfigLoaded && appConfigLoading" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>
  <section v-else class="wallet-card settings-empty-card">
    <h3>{{ t('发票') }}</h3>
    <StudioEmpty compact :title="t('发票功能暂未开放')" :description="t('开通后可在这里为已支付订单申请电子发票。')" />
  </section>
</template>
