# 本地化页面标题设计

## 目标

将静态 HTML 的 `<title>` 改为英文兜底，并让 React 挂载后的 `document.title` 始终跟随当前 i18n 语言。

## 方案

- `apps/web/index.html` 使用 `Shiny Colors Song Guess` 作为静态标题。
- `apps/web/src/i18n/locales/{zh,ja,en}.json` 增加 `meta.title`，分别提供三语标题。
- `apps/web/src/i18n/index.ts` 增加集中式标题更新函数：初始化完成后按初始语言设置标题，并在 `languageChanged` 事件中更新；复用现有语言归一化和持久化事件，不在组件中重复监听。

## 验证

- 三份 locale key 结构和插值变量仍保持一致。
- typecheck、测试和生产构建通过。
- 语言切换事件会更新 `document.title`，静态 HTML 在脚本执行前显示英文标题。
