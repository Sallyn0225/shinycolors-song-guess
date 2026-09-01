# 开源仓库社区文件补全：CONTRIBUTING / SECURITY / Issue 模板

## Goal

为开源仓库补齐社区文件：CONTRIBUTING.md（人类贡献者入口）、SECURITY.md（漏洞私密上报渠道）、.github/ISSUE_TEMPLATE（bug/feature 模板，内置『无音源跑不起来是预期』FAQ）。纯文档新增，不涉及代码。

## Background

仓库已开源（github.com/Sallyn0225/shinycolors-song-guess），README / LICENSE / NOTICE / CI / 部署文档齐备，但缺少：

1. 面向人类的贡献指南（目前只有面向 AI 的 AGENTS.md）
2. 安全漏洞上报渠道（项目含公网服务端 + WebSocket，值得有）
3. Issue 模板（「克隆后跑不起来」是预期行为，没有模板会被该类 issue 刷屏）

## Requirements

- **CONTRIBUTING.md**（中文，与仓库现有文档语言一致）：
  - 本地开发环境搭建（Node ≥ 20 / pnpm / ffmpeg；音源自备、`pnpm assets all`）
  - 仓库结构与规范文档的阅读入口（DESIGN.md、`.trellis/spec/`、README 的两条核心设计约束）
  - 提交信息规范（conventional commits，中文 subject，与 git log 现状一致）
  - PR 前自检命令（与 CI 对齐：`pnpm -r typecheck`、不依赖曲库的测试集）
  - 明确不收的贡献类型：音源/官方素材的分发、曲库数据的下载链接
- **SECURITY.md**（中文为主）：
  - 支持版本：main 分支
  - 上报方式：GitHub 私密漏洞报告（Security → Report a vulnerability），不要开公开 issue
  - 范围说明：防作弊边界是「挡休闲作弊」而非密码学安全（引用 README 的设计约束，不展开内部细节）
- **.github/ISSUE_TEMPLATE/**：
  - `bug_report.md`：含「启动报错先自查」清单（音源未构建 / ffmpeg 缺失）、复现步骤、环境（浏览器、单机或联机、部署形态）
  - `feature_request.md`：玩法提案需说明动机与预期体验
  - `config.yml`：开 blank issue 前的引导（保持简单）
- **README.md**：文档表中挂上 CONTRIBUTING / SECURITY 链接（小改动）

## Constraints

- 所有新文件用中文（仓库现有文档语言）
- 不改动任何代码、CI、LICENSE / NOTICE
- 不涉及 PROGRESS.md 的去留（另行决策）
- 模板与文档中不出现内部私有路径或密钥

## Acceptance Criteria

- [x] CONTRIBUTING.md 存在且覆盖 Requirements 所列五项
- [x] SECURITY.md 存在且指明私密上报渠道、支持版本
- [x] .github/ISSUE_TEMPLATE/ 下有 bug_report.md 与 feature_request.md；bug 模板含「无音源跑不起来是预期」自查项
- [x] README.md 文档表新增 CONTRIBUTING / SECURITY 条目
- [x] `git status` 中无代码文件改动
- [x] CI 工作流无需变更（纯 Markdown，无构建影响）

## Notes

- 轻量任务，PRD-only。
