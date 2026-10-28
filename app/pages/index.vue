<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { isLoggedIn, hydrate } = useAuth()
const { track } = useTrack()
const { pricingOpen, gotoPricing } = usePricingModal()

definePageMeta({
  layout: 'landing',
  middleware: 'landing-home',
})

useSeoMeta({
  description: () => t('EasyTV 是 AI 视频创作平台：在自由画布上组合文本、图片、视频、音频节点，一句话生成电影感短片、商业广告与短剧成片。'),
  ogTitle: () => t('EasyTV · 一起创作好故事'),
})

useHead({
  title: () => t('一起创作好故事'),
})

const prompt = ref('')
const activeFilm = ref(0)
const stageHover = ref(false)
let rotateTimer: ReturnType<typeof setInterval> | undefined

const films = computed(() => [
  {
    title: t('星空山巅'),
    author: 'Scenic',
    gif: '/gifs/showcase/scenic.webp',
    cover: '/images/showcase/mountain.jpg',
  },
  {
    title: t('礁岸纪实'),
    author: 'Studio',
    gif: '/gifs/showcase/coast.webp',
    cover: '/images/showcase/coast.jpg',
  },
  {
    title: t('林间飞瀑'),
    author: 'Nature',
    gif: '/gifs/showcase/waterfall.webp',
    cover: '/images/showcase/waterfall.jpg',
  },
  {
    title: t('青春纪实'),
    author: 'Campus',
    gif: '/gifs/login-hero.webp',
    cover: '/images/showcase/portrait.jpg',
  },
  {
    title: t('音乐现场'),
    author: 'Beat',
    gif: '/gifs/showcase/music.webp',
    cover: '/images/showcase/music.jpg',
  },
  {
    title: t('航拍海浪'),
    author: 'Aerial',
    gif: '/gifs/showcase/ocean.webp',
    cover: '/images/showcase/ocean.jpg',
  },
  {
    title: t('夜城未眠'),
    author: 'Neon',
    gif: '/gifs/showcase/city-night.webp',
    cover: '/images/showcase/city-night.jpg',
  },
  {
    title: t('赛博夜雨'),
    author: 'Pixel',
    gif: '/gifs/showcase/neon-rain.webp',
    cover: '/images/showcase/neon-rain.jpg',
  },
  {
    title: t('荒漠公路'),
    author: 'Wander',
    gif: '/gifs/showcase/desert-road.webp',
    cover: '/images/showcase/desert-road.jpg',
  },
  {
    title: t('都市漫步'),
    author: 'Street',
    gif: '/gifs/showcase/city-walk.webp',
    cover: '/images/showcase/city-walk.jpg',
  },
])

const current = computed(() => (films.value[activeFilm.value] ?? films.value[0]) as (typeof films.value)[number])
const heroGif = '/gifs/login-hero.webp'

const agents = computed(() => [
  {
    title: 'EasyTV Agent',
    desc: t('短剧、广告与口播一站生成，从剧本到成片都在一个对话里完成。'),
    icon: 'i-lucide-sparkles',
    to: '/agent',
  },
  {
    title: t('视频创作'),
    desc: t('一句话生成分镜、配乐和超分成片，适合先把故事拍出来。'),
    icon: 'i-lucide-clapperboard',
    to: '/create',
  },
  {
    title: t('自由画布'),
    desc: t('用节点编排镜头与素材，精细控制每一镜的节奏和光影。'),
    icon: 'i-lucide-workflow',
    to: '/canvas',
  },
  {
    title: t('成片资产'),
    desc: t('作品、素材和历史成片集中管理，随时回看和再创作。'),
    icon: 'i-lucide-folder',
    to: '/assets',
  },
])

const steps = computed(() => [
  { n: '01', title: t('写下灵感'), desc: t('用一句话描述人物、场景和情绪，不必先会剪辑。') },
  { n: '02', title: t('Agent 拆镜头'), desc: t('自动拆分镜、补齐对白与节奏，把故事变成可拍的结构。') },
  { n: '03', title: t('生成成片'), desc: t('画面、配乐和运镜一次出片，再按你的感觉微调。') },
])

const marketing = computed(() => [
  { title: t('剧情广告'), desc: t('把卖点写进故事里'), cover: '/images/showcase/city-night.jpg' },
  { title: t('分镜脚本'), desc: t('一句话拆成可拍镜头'), cover: '/images/showcase/desert-road.jpg' },
  { title: t('品牌大片'), desc: t('电影感光影与运镜'), cover: '/images/showcase/mountain.jpg' },
  { title: t('口播成片'), desc: t('人物特写与产品植入'), cover: '/images/showcase/portrait.jpg' },
  { title: t('短剧连载'), desc: t('人物与情节持续统一'), cover: '/images/showcase/city-walk.jpg' },
  { title: t('音乐 MV'), desc: t('节奏剪辑与情绪推进'), cover: '/images/showcase/music.jpg' },
  { title: t('赛博短片'), desc: t('霓虹、雨水与游戏镜头'), cover: '/images/showcase/neon-rain.jpg' },
  { title: t('航拍广告'), desc: t('海面与城市大场面'), cover: '/images/showcase/ocean.jpg' },
])

const voices = computed(() => [
  {
    quote: t('把脑子里的画面落地，这是创作最难的一步。EasyTV 让这一步变得像在讲故事。'),
    name: '阿野',
    role: t('短剧创作者'),
  },
  {
    quote: t('不是“这是 AI 做的”，而是“这是我做的”。镜头、节奏和情绪都能自己拿捏。'),
    name: '林屿',
    role: t('广告导演'),
  },
  {
    quote: t('从提示词到成片都在一个工作台里，适合把长故事真正做完整。'),
    name: '陈舟',
    role: t('独立制片'),
  },
  {
    quote: t('以前一个广告要排很久，现在先用 Agent 把分镜和成片跑出来，客户也更容易拍板。'),
    name: '苏晚',
    role: t('品牌策划'),
  },
  {
    quote: t('自由画布把我卡住的那几镜救回来了。生成只是开始，后面还能自己改节奏。'),
    name: '何川',
    role: t('MV 导演'),
  },
])

const headerSolid = ref(false)
const activeNav = ref('')
let navLock: string | null = null
let navLockTimer: ReturnType<typeof setTimeout> | undefined

const navItems = computed(() => [
  { id: 'works', label: t('精选作品') },
  { id: 'create', label: t('创作工具') },
  { id: 'market', label: t('创意营销') },
  { id: 'voices', label: t('创作者声音') },
])

onMounted(() => {
  hydrate()
  if (isLoggedIn.value) {
    void navigateTo(localePath('/studio'))
    return
  }
  startRotate()
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  stopRotate()
  if (navLockTimer)
    clearTimeout(navLockTimer)
  if (import.meta.client)
    window.removeEventListener('scroll', onScroll)
})

watch(stageHover, (hover) => {
  if (hover)
    stopRotate()
  else
    startRotate()
})

function startRotate() {
  stopRotate()
  rotateTimer = setInterval(() => {
    activeFilm.value = (activeFilm.value + 1) % films.value.length
  }, 6000)
}

function stopRotate() {
  if (rotateTimer) {
    clearInterval(rotateTimer)
    rotateTimer = undefined
  }
}

function selectFilm(index: number) {
  activeFilm.value = index
  if (!stageHover.value)
    startRotate()
}

function onScroll() {
  headerSolid.value = window.scrollY > 12
  if (navLock) {
    activeNav.value = navLock
    return
  }
  const offset = 120
  let current = ''
  for (const item of navItems.value) {
    const el = document.getElementById(item.id)
    if (!el)
      continue
    if (el.getBoundingClientRect().top - offset <= 0)
      current = item.id
  }
  activeNav.value = current
}

function goNav(id: string) {
  const el = document.getElementById(id)
  if (!el)
    return
  navLock = id
  activeNav.value = id
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
  if (navLockTimer)
    clearTimeout(navLockTimer)
  navLockTimer = setTimeout(() => {
    navLock = null
  }, 800)
}

/** 匿名也能进的创作页：成片向导第 1 步可以先填需求，点「生成策划案」时才要求登录 */
const ANONYMOUS_OK = ['/create']

function goStudio(extra = '') {
  const to = extra || '/studio'
  if (isLoggedIn.value || ANONYMOUS_OK.includes(to.split('?')[0] ?? ''))
    return navigateTo(localePath(to))
  return navigateTo(localePath({
    path: '/login',
    query: { redirect: to },
  }))
}

function onCreate() {
  const q = prompt.value.trim()
  track('landing_cta', { with_prompt: q ? 1 : 0 })
  void goStudio(q ? `/agent?prompt=${encodeURIComponent(q)}` : '/studio')
}
</script>

<template>
  <div>
    <header class="lp-header" :class="{ 'is-solid': headerSolid }">
      <NuxtLink :to="localePath('/')" class="lp-brand">
        <img src="/images/logo.svg" alt="EasyTV" width="28" height="28">
        EasyTV
      </NuxtLink>
      <nav class="lp-nav">
        <a
          v-for="item in navItems"
          :key="item.id"
          :href="`#${item.id}`"
          :class="{ 'is-on': activeNav === item.id }"
          @click.prevent="goNav(item.id)"
        >
          {{ item.label }}
        </a>
        <a
          :href="localePath('/pricing')"
          :class="{ 'is-on': pricingOpen }"
          @click.prevent="gotoPricing('membership')"
        >
          {{ t('定价') }}
        </a>
      </nav>
      <div class="lp-header__actions">
        <SiteLocaleSwitcher />
        <ThemeToggle class="lp-theme" />
        <NuxtLink :to="localePath('/login')" class="lp-ghost">
          {{ t('登录') }}
        </NuxtLink>
        <button type="button" class="lp-solid" @click="onCreate">
          {{ t('开始创作') }}
        </button>
      </div>
    </header>

    <section class="lp-hero">
      <img
        class="lp-hero__video"
        :src="heroGif"
        alt=""
        decoding="async"
      />
      <div class="lp-hero__mask" />
      <div class="lp-hero__inner">
        <p class="lp-kicker">{{ t('AI 视频创作平台') }}</p>
        <h1>{{ t('一起创作好故事') }}</h1>
        <p class="lp-sub">{{ t('输入你的灵感，即刻开始创作大片') }}</p>
        <form class="lp-input" @submit.prevent="onCreate">
          <input
            v-model="prompt"
            type="text"
            :placeholder="t('输入你的灵感，开始创作…')"
          >
          <button type="submit">{{ t('开始创作') }}</button>
        </form>
      </div>
    </section>

    <section id="works" class="lp-section">
      <p class="lp-kicker lp-kicker--left">{{ t('精选作品') }}</p>
      <h2 class="lp-h2">{{ t('把灵感做成能看完的故事') }}</h2>
      <p class="lp-lead">{{ t('来自 EasyTV 的概念短片，点击切换预览。') }}</p>
      <div class="lp-feature">
        <div
          class="lp-feature__stage"
          @mouseenter="stageHover = true"
          @mouseleave="stageHover = false"
        >
          <img
            :key="current.gif"
            class="lp-feature__video"
            :src="current.gif"
            :alt="current.title"
            decoding="async"
          >
          <div class="lp-feature__meta">
            <h2>{{ current.title }}</h2>
            <p>{{ t('EasyTV 精选短片，作者 {author}', { author: `@${current.author}` }) }}</p>
            <div class="lp-feature__actions">
              <button type="button" @click="onCreate">{{ t('观看全片') }}</button>
              <button type="button" class="is-ghost" @click="onCreate">{{ t('查看工作流') }}</button>
            </div>
          </div>
        </div>
        <div class="lp-thumbs">
          <button
            v-for="(film, i) in films"
            :key="film.title"
            type="button"
            :class="{ 'is-on': activeFilm === i }"
            :style="{ backgroundImage: `url(${film.cover})` }"
            :title="film.title"
            @click="selectFilm(i)"
          />
        </div>
      </div>
    </section>

    <section id="create" class="lp-section">
      <h2 class="lp-h2">{{ t('专业内容创作 Agent') }}</h2>
      <p class="lp-lead">{{ t('视频生成、自由画布与成片管理，把灵感做成能讲完的故事。') }}</p>
      <div class="lp-agents">
        <button
          v-for="item in agents"
          :key="item.title"
          type="button"
          class="lp-agent"
          @click="goStudio(item.to)"
        >
          <UIcon :name="item.icon" class="size-6" />
          <h3>{{ item.title }}</h3>
          <p>{{ item.desc }}</p>
        </button>
      </div>
    </section>

    <section id="howto" class="lp-section">
      <h2 class="lp-h2">{{ t('三步开始创作') }}</h2>
      <p class="lp-lead">{{ t('不用先学剪辑，从一句话走到成片。') }}</p>
      <div class="lp-steps">
        <article v-for="item in steps" :key="item.n" class="lp-step">
          <span>{{ item.n }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.desc }}</p>
        </article>
      </div>
    </section>

    <section id="market" class="lp-section">
      <h2 class="lp-h2">{{ t('一栈式创意营销') }}</h2>
      <p class="lp-lead">{{ t('广告、短剧、口播和 MV，按场景直接开始。') }}</p>
      <div class="lp-market">
        <button
          v-for="item in marketing"
          :key="item.title"
          type="button"
          class="lp-market__card"
          :style="{ '--cover': `url(${item.cover})` }"
          @click="onCreate"
        >
          <h3>{{ item.title }}</h3>
          <p>{{ item.desc }}</p>
        </button>
      </div>
    </section>

    <section id="voices" class="lp-section">
      <h2 class="lp-h2">{{ t('我们用户的声音') }}</h2>
      <div class="lp-voices">
        <blockquote v-for="item in voices" :key="item.name">
          <p>{{ item.quote }}</p>
          <footer>
            <strong>{{ item.name }}</strong>
            <span>{{ item.role }}</span>
          </footer>
        </blockquote>
      </div>
    </section>

    <section id="cta" class="lp-cta">
      <h2>{{ t('EasyTV，帮助灵感立即成片') }}</h2>
      <p>{{ t('输入一句灵感，从分镜到成片都在同一个工作台。') }}</p>
      <button type="button" class="lp-solid" @click="onCreate">
        {{ t('开始创作') }}
      </button>
    </section>

    <footer class="lp-footer">
      <div class="lp-footer__grid">
        <div class="lp-footer__brand">
          <div class="lp-brand">
            <img src="/images/logo.svg" alt="" width="22" height="22">
            EasyTV
          </div>
          <p>{{ t('AI 视频创作平台，把脑子里的画面做成能看完的故事。') }}</p>
        </div>
        <div>
          <h3>{{ t('创作工具') }}</h3>
          <button type="button" @click="goStudio('/agent')">EasyTV Agent</button>
          <button type="button" @click="goStudio('/create')">{{ t('视频创作') }}</button>
          <button type="button" @click="goStudio('/canvas')">{{ t('自由画布') }}</button>
          <a
            :href="localePath('/pricing')"
            @click.prevent="gotoPricing('membership')"
          >{{ t('定价') }}</a>
        </div>
        <div>
          <h3>{{ t('服务条款') }}</h3>
          <NuxtLink :to="localePath('/legal/terms')">{{ t('用户协议') }}</NuxtLink>
          <NuxtLink :to="localePath('/legal/privacy')">{{ t('隐私政策') }}</NuxtLink>
          <NuxtLink :to="localePath('/legal/ai-guidelines')">{{ t('AI 使用规范') }}</NuxtLink>
        </div>
        <div>
          <h3>{{ t('联系我们') }}</h3>
          <a href="mailto:hello@easytv.com">hello@easytv.com</a>
          <NuxtLink :to="localePath('/login')">{{ t('登录账号') }}</NuxtLink>
          <button type="button" @click="onCreate">{{ t('开始创作') }}</button>
        </div>
      </div>
      <p class="lp-footer__copy">© {{ new Date().getFullYear() }} EasyTV</p>
    </footer>
  </div>
</template>
