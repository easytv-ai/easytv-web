<script setup lang="ts">
const { t } = useI18n()

const items = [
  {
    q: t('积分有效期规则'),
    a: t('会员每月到账积分随当前账期有效。单独充值的积分按所购档位计算，有效期为 30 天、90 天、1 年或 2 年，到期未用完将自动失效。'),
  },
  {
    q: t('会员与积分退款规则'),
    a: t('数字内容开通后默认不支持无理由退款。如遇重复扣款或系统故障，请联系客服核实后处理。'),
  },
  {
    q: t('积分返还规则'),
    a: t('生成失败或任务被系统取消时，对应积分会自动返还到积分钱包，一般在数分钟内到账。'),
  },
  {
    q: t('积分消耗顺序'),
    a: t('优先消耗即将到期的积分，再消耗会员账期内积分，最后消耗长期充值积分。'),
  },
  {
    q: t('如何获取更多积分'),
    a: t('可开通更高档会员获得每月额度，或通过「积分充值」按档加购。会员享受加购价。'),
  },
  {
    q: t('创作会员和团队版有什么不同'),
    a: t('创作会员面向个人。团队版按席位计费，积分进入共享积分池，并提供席位管理、用量看板和协作画布。'),
  },
  {
    q: t('发票申请与联系方式'),
    a: t('支付成功后可申请发票。商务与开票请发送邮件至 {email}。', { email: 'hello@easytv.com' }),
  },
  {
    q: t('会员权益 7 天保护计划'),
    a: t('首次开通会员 7 天内，如未产生实质消耗，可联系客服申请调整方案。具体以核实结果为准。'),
  },
]

const supportHref = 'mailto:hello@easytv.com'
</script>

<template>
  <section class="plan-faq" aria-labelledby="plan-faq-title">
    <h2 id="plan-faq-title">{{ t('常见问题') }}</h2>
    <div class="plan-faq__list">
      <details
        v-for="item in items"
        :key="item.q"
        class="plan-faq__item"
      >
        <summary>
          <span>{{ item.q }}</span>
          <span class="plan-faq__chevron">
            <UIcon name="i-lucide-chevron-down" class="size-4" />
          </span>
        </summary>
        <p>{{ item.a }}</p>
      </details>
      <a class="plan-faq__item plan-faq__link" :href="supportHref">
        <span>{{ t('联系客服') }}</span>
        <UIcon name="i-lucide-chevron-right" class="size-4" />
      </a>
    </div>
  </section>
</template>
