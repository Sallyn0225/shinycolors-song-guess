# Localization Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete i18next coverage for every user-facing hardcoded string in `apps/web/src`, preserving the existing Chinese template text and adding complete Japanese and English translations.

**Architecture:** Keep the existing `resources` shape and flat nested translation namespaces. Components obtain copy through `useTranslation()`; rich text remains React structure rather than embedding HTML in translation strings. Language agents edit only their assigned locale file; the parent integrates component changes and validates all locale contracts.

**Tech Stack:** React, TypeScript, i18next, react-i18next, Vite, pnpm.

**Spec:** `docs/superpowers/specs/2026-02-14-localization-completion-design.md`

## Global Constraints

- Chinese `zh.json` uses the existing Chinese text from the web templates; do not retranslate it.
- Japanese and English translations are produced by separate language subagents.
- Each language subagent edits only its own locale JSON file.
- Preserve the user’s existing uncommitted `apps/web/vite.config.ts` change.
- Do not localize development comments, tests, or proper names in domain data.

---

### Task 1: Inventory and define translation keys

**Files:**
- Inspect: `apps/web/src/**/*.tsx`
- Inspect: `apps/web/src/i18n/locales/zh.json`
- Modify: `apps/web/src/i18n/locales/zh.json`

**Interfaces:**
- Produces the complete key inventory and Chinese source values consumed by Tasks 2–4.

- [ ] **Step 1: Search all UI hardcoded strings**

Run:
```bash
grep -RInE "(aria-label|title=|placeholder=|>[^<{]*[一-龥ぁ-んァ-ン])" apps/web/src --include='*.tsx' --include='*.ts' --exclude='*.test.ts'
```
Record only user-facing text and dynamic message templates; exclude comments, proper nouns, URLs, and code labels.

- [ ] **Step 2: Add missing Chinese keys**

Add keys grouped under the owning screen/component namespace, copying the exact existing Chinese UI wording. Use interpolation placeholders such as `{{count}}`, `{{seconds}}`, and `{{name}}` for dynamic values.

- [ ] **Step 3: Validate Chinese JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/zh.json','utf8')); console.log('zh.json OK')"
```
Expected: `zh.json OK`.

- [ ] **Step 4: Commit source-key inventory**

```bash
git add apps/web/src/i18n/locales/zh.json
git commit -m "feat(i18n): add missing Chinese locale keys"
```

### Task 2: Translate Japanese locale

**Files:**
- Modify: `apps/web/src/i18n/locales/ja.json`

**Interfaces:**
- Consumes the key inventory from Task 1.
- Produces a key-complete Japanese locale with identical interpolation placeholders.

- [ ] **Step 1: Translate every new key**

Copy the complete key structure from `zh.json`; translate user-facing prose, controls, status messages, accessibility labels, and placeholders into natural Japanese. Preserve proper names and interpolation tokens exactly.

- [ ] **Step 2: Validate key and placeholder parity**

Run a script that recursively compares JSON leaf-key paths and `{{...}}` token sets between `zh.json` and `ja.json`; expected result is no missing, extra, or placeholder-mismatch entries.

- [ ] **Step 3: Commit Japanese locale**

```bash
git add apps/web/src/i18n/locales/ja.json
git commit -m "feat(i18n): complete Japanese translations"
```

### Task 3: Translate English locale

**Files:**
- Modify: `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes the key inventory from Task 1.
- Produces a key-complete English locale with identical interpolation placeholders.

- [ ] **Step 1: Translate every new key**

Copy the complete key structure from `zh.json`; translate user-facing prose, controls, status messages, accessibility labels, and placeholders into natural English. Preserve proper names and interpolation tokens exactly.

- [ ] **Step 2: Validate key and placeholder parity**

Run the same recursive key/token comparison against `zh.json`; expected result is no missing, extra, or placeholder-mismatch entries.

- [ ] **Step 3: Commit English locale**

```bash
git add apps/web/src/i18n/locales/en.json
git commit -m "feat(i18n): complete English translations"
```

### Task 4: Migrate components to i18n

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/InfoModal.tsx`
- Modify: `apps/web/src/components/OptionBar.tsx`
- Modify: `apps/web/src/components/Footer.tsx`
- Modify: `apps/web/src/screens/Lobby.tsx`
- Modify: `apps/web/src/screens/Karuta.tsx`
- Modify: `apps/web/src/screens/Splash.tsx`
- Modify: `apps/web/src/ui/ShareDialog.tsx`
- Modify: `apps/web/src/ui/Countdown.tsx`
- Modify: `apps/web/src/ui/ReadyCountdown.tsx`
- Modify: `apps/web/src/ui/PrismRail.tsx`
- Modify: `apps/web/src/features/narrate.ts`

**Interfaces:**
- Consumes the complete locale keys from Tasks 1–3.
- Produces components whose user-visible copy changes with i18next language selection.

- [ ] **Step 1: Add translation hooks/imports**

Use `useTranslation()` in React components. For non-React narration helpers, pass translated labels/messages into the function or use the existing i18n instance without introducing React hooks into pure feature code.

- [ ] **Step 2: Replace hardcoded UI text**

Replace every inventory item with `t('namespace.key', variables)`. Preserve `<span lang="ja">`, bold, links, and other markup by keeping them in JSX and translating only text segments. Use `Trans` only where interpolation must contain React nodes.

- [ ] **Step 3: Preserve dynamic grammar and accessibility semantics**

Move combined status strings into interpolation-based keys instead of concatenating translated fragments when word order differs by language. Translate `aria-label`, `aria-valuetext`, `title`, `placeholder`, and `sr-only` content as well.

- [ ] **Step 4: Commit component migration**

```bash
git add apps/web/src/App.tsx apps/web/src/components apps/web/src/screens apps/web/src/ui apps/web/src/features/narrate.ts
git commit -m "feat(i18n): localize remaining user-facing copy"
```

### Task 5: Verify integration

**Files:**
- Inspect: `apps/web/src/i18n/locales/{zh,ja,en}.json`
- Inspect: `apps/web/src/**/*.tsx`

**Interfaces:**
- Verifies all outputs from Tasks 1–4.

- [ ] **Step 1: Compare locale keys and placeholders**

Run the recursive parity script for all three locale files. Expected: identical leaf-key paths and interpolation token sets.

- [ ] **Step 2: Search for remaining hardcoded UI copy**

Run the inventory grep again and manually classify every remaining match. Expected: only proper names, code/data strings, or comments remain.

- [ ] **Step 3: Run project checks**

Run:
```bash
pnpm --filter web build
pnpm --filter web test
```
Expected: both commands exit successfully.

- [ ] **Step 4: Confirm worktree safety**

Run:
```bash
git status --short
git diff -- apps/web/vite.config.ts
```
Expected: the existing `vite.config.ts` user modification remains present and is not overwritten; no unrelated files are changed.
