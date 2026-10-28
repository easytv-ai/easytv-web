export default defineNuxtPlugin({
  name: 'auth-hydrate',
  enforce: 'pre',
  setup() {
    useAuth().hydrate()
  },
})
