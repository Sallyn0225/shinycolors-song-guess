<div align="center">

# 🎵 シャニソン当てクイズ
### 闪耀色彩猜歌 · ShinyColors Song Guess

[![CI](https://github.com/Sallyn0225/shinycolors-song-guess/actions/workflows/ci.yml/badge.svg)](https://github.com/Sallyn0225/shinycolors-song-guess/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-black.svg)](https://fastify.dev/)

**听伴奏，猜歌名** —— 244 首《偶像大师 闪耀色彩》off vocal 音源，1464 个 15 秒片段

[🎮 快速开始](#-快速开始) · [📖 文档](#-文档) · [🏗️ 架构](#️-架构) · [📦 部署](#-部署到服务器)

</div>

---

## ⚠️ 重要提示

> **这是非官方粉丝作品**，与万代南梦宫娱乐及「アイドルマスター シャイニーカラーズ」运营方无关联、未获认可。仓库内的角色语音、立绘、背景视频等素材版权归原权利人所有，不在本仓库的 MIT 许可范围内。详见 [NOTICE](NOTICE)。

### 🔒 需要自备音源

**克隆这个仓库无法直接运行游戏。** 音源（`songs/`，约 1.7 GB）和由它构建出的曲库（`assets/`，切片 + 封面 + manifest，约 228 MB）**都不入库，也不提供下载**。

没有曲库时启动服务端会直接报：

```
曲库为空——请先跑 pnpm assets all
```

> 💡 这是预期行为，不是 bug。你需要自备合法取得的 off vocal 音源放进 `songs/`，再在本地构建曲库。这件事无法绕过——提供下载就等于分发音源。

---

## ✨ 功能特性

- 🎯 **单机四选一** —— 经典猜歌玩法
- ⚔️ **1v1 空札領地戦** —— 把日本竞技歌牌规则搬到听歌上：抢牌、送り札、お手つき，外加只会被播放、场上却没有对应牌的**空札**
- 🔐 **曲库保密** —— 客户端拿不到 `sliceId`、时长、切片数，切片 URL 使用每局随机的一次性 token
- ⚡ **公平判定** —— 基于「相对片段起播的反应时间」而非收包时间，蓝牙耳机延迟不影响胜负
- 🏠 **局域网开黑** —— 无需反代和 TLS，即开即玩

---

## 📋 目录

- [重要提示](#️-重要提示)
- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
  - [本地开发](#本地开发)
  - [部署到服务器](#-部署到服务器)
- [架构](#️-架构)
- [文档](#-文档)
- [许可](#-许可)

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 20
- **pnpm** (包管理器)
- **ffmpeg** (音频处理)

### 三步启动

```bash
# 1️⃣ 安装依赖
pnpm install

# 2️⃣ 构建曲库：切片 + 封面 + manifest
# 需要 songs/ 里已有音源，耗时较久
pnpm assets all

# 3️⃣ 构建前端并启动服务
pnpm --filter @scg/web build
pnpm --filter @scg/server start
```

🎉 访问 [http://localhost:5179](http://localhost:5179) 开始游戏！

### 本地开发

前后端分离开发模式：

```bash
# 终端 1：后端（tsx watch）
pnpm --filter @scg/server dev

# 终端 2：前端（vite）
pnpm --filter @scg/web dev
```

> 💡 局域网开黑到这一步就够了，不需要反代和 TLS。

### 🐳 部署到服务器

使用 Docker Compose 一键部署：

```bash
# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DOMAIN，或对接你已有的反代

# 启动服务
docker compose up -d
```

**特点：**
- ✅ 镜像由 GitHub Actions 构建推送至 GHCR
- ✅ 曲库以**只读挂载**方式喂进容器（不进镜像）
- ✅ 2C4G 机器即可运行——真正的约束是带宽而不是 CPU

📖 完整部署步骤、反向代理的三条硬要求、以及**哪些目录不要传上服务器**，见 [DEPLOY.md](DEPLOY.md)。

---

## 🏗️ 架构

基于 pnpm workspace 的 monorepo，包含四个核心包：

| 包 | 技术栈 | 职责 |
|---|---|---|
| `apps/server` | Fastify 5 | HTTP + WebSocket 对局、单机会话、音频切片下发、环境 BGM、静态托管 |
| `apps/web` | React 18 + Vite 6 + Tailwind 4 | 全部游戏界面 |
| `packages/shared` | TypeScript | 前后端共用的协议类型与调参常量（**契约的唯一来源**） |
| `packages/game-core` | TypeScript | 出题、计分、牌场推进的纯函数（无 IO、可确定性重放） |
| `tools/prepare-audio` | Node.js + ffmpeg | 构建管线：切片、响度归一、封面处理、manifest 生成 |

### 🔐 核心设计约束

改代码前值得先读这两条贯穿全局的设计约束：

#### 1️⃣ 曲库保密

客户端拿不到 `sliceId`、时长、切片数。切片 URL 用的是每局随机的一次性 token，响应 `no-store` 且不带 `Last-Modified`——mtime 会泄漏构建顺序（即曲名字典序）。

#### 2️⃣ 判定按反应时间

蓝牙耳机有 150~300ms 输出延迟，所以判定基于「相对片段起播的反应时间」而非收包时间。网络快慢不影响胜负。

---

## 📖 文档

| 文档 | 内容 |
|---|---|
| [PRODUCT.md](PRODUCT.md) | 🎯 玩家是谁、玩法定位、运行环境的现实约束 |
| [DESIGN.md](DESIGN.md) | 🎨 界面与交互设计 |
| [DEPLOY.md](DEPLOY.md) | 🚀 部署：单进程模式、环境变量、反向代理、房间配额 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 👥 贡献指南：环境搭建、先读什么、提交规范 |
| [SECURITY.md](SECURITY.md) | 🔒 漏洞上报渠道与安全边界 |

---

## 📄 许可

- **代码**（`apps/` `packages/` `tools/` 及根目录文档）：[MIT](LICENSE)
- **素材**：不在 MIT 范围内，归属与使用说明见 [NOTICE](NOTICE)

> ⚠️ LICENSE 开头有一段适用范围限定，请连同 NOTICE 一起阅读——仓库作者对第三方素材不主张任何权利，也无权转授。

---

<div align="center">

**[⬆ 回到顶部](#-シャニソン当てクイズ)**

Made with ❤️ by fans, for fans

</div>
