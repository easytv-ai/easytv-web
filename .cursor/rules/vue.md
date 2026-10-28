* 页面遵循Vue 3 Composition API
* 页面变量定义，放在state中，分页参数与state并列，如下：
    ```
        const state = reactive({
            name: ''',
            noData: false,
            tableData: [] as any,
            dialogVisible: false
        })

        const pagination = reactive({
            page: 1,
            size: 10,
            total: 0,
        })

    ```
* app/components 里面的组件命名规则，例如：/app/components/Header/index.vue
* app/pages/**/components 里面的组件命名规则，例如：/app/pages/product/components/category-edit.vue，/app/pages/company/components/edit.vue
* 当页面中包括弹框等独立模块功能时，请提取组件，放到当前目录的components里面
* 样式表基于 tailwindcss 编写
* 页面配色与组件样式统一使用 `app/assets/css/main.css` 中的 `--ea-*` token 与 `.ea-*` 工具类，详见 `DESIGN-SYSTEM.md`
