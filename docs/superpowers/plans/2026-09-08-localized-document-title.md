# Localized Document Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the static HTML title English and keep `document.title` synchronized with the active i18n language.

**Architecture:** Add one `meta.title` resource key per locale. Centralize title updates in `src/i18n/index.ts`, setting the initial title after i18n initialization and updating it from the existing `languageChanged` listener.

**Tech Stack:** HTML, TypeScript, i18next.

**Spec:** `docs/superpowers/specs/2026-09-08-localized-document-title-design.md`

## Global Constraints

- Static fallback title is exactly `Shiny Colors Song Guess`.
- Preserve existing `vite.config.ts` user changes.
- Do not add a component-level title effect or duplicate language listeners.

---

### Task 1: Add title resources and runtime synchronization

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/i18n/index.ts`
- Modify: `apps/web/src/i18n/locales/zh.json`
- Modify: `apps/web/src/i18n/locales/ja.json`
- Modify: `apps/web/src/i18n/locales/en.json`

- [ ] **Step 1: Change the static fallback**

Replace the existing `<title>` text in `apps/web/index.html` with `Shiny Colors Song Guess`.

- [ ] **Step 2: Add locale titles**

Add `meta.title` to all three locale files, using `闪耀色彩 猜歌` for Chinese, `シャイニーカラーズ 曲当て` for Japanese, and `Shiny Colors Song Guess` for English.

- [ ] **Step 3: Centralize title updates**

In `apps/web/src/i18n/index.ts`, add:
```ts
export function setDocumentTitle(lang: string) {
  if (typeof document !== 'undefined') {
    document.title = i18n.getFixedT(lang)('meta.title')
  }
}
```
Call it once after `.init(...)` using `initialLang`, and call it in the existing `languageChanged` listener before persistence handling.

- [ ] **Step 4: Verify**

Run:
```bash
pnpm --filter @scg/web typecheck
pnpm --filter @scg/web test
pnpm --filter @scg/web build
```
Expected: all commands pass; `vite.config.ts` remains the only unrelated worktree modification.

- [ ] **Step 5: Commit**

```bash
git add apps/web/index.html apps/web/src/i18n/index.ts apps/web/src/i18n/locales/{zh,ja,en}.json
git commit -m "feat(i18n): synchronize document title with language"
```
