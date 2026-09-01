<div align="center">

# 🎵 闪耀色彩猜歌 · ShinyColors Song Guess
### シャニソン当てクイズ

[![CI](https://github.com/Sallyn0225/shinycolors-song-guess/actions/workflows/ci.yml/badge.svg)](https://github.com/Sallyn0225/shinycolors-song-guess/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-black.svg)](https://fastify.dev/)

**听伴奏，猜歌名** —— 专为《偶像大师 闪耀色彩》（THE IDOLM@STER SHINY COLORS）制作的纯伴奏猜歌网页游戏

[🎮 快速开始](#-快速开始) · [✨ 游戏特性](#-游戏特性) · [🏗️ 项目架构](#️-项目架构) · [📦 部署指南](#-部署指南)

</div>

---

## ⚠️ 重要说明

> **非官方粉丝作品声明**  
> 本项目为非官方、非商业用途的粉丝独立创作，与万代南梦宫娱乐（BANDAI NAMCO Entertainment）及 283Production 没有任何关联。游戏内涉及的角色语音、图像及音乐版权均归原权利人所有，不包含在开源 MIT 许可范围内，详情请参阅 [NOTICE](NOTICE)。

### 🔒 音频资源自备说明

为了遵守版权规范，**本仓库不包含、也不提供任何歌曲音频文件的下载**。

启动游戏前，你需要准备好相关的伴奏音频（Off Vocal）放入 `songs/` 目录，并运行本地工具生成游戏所需的音频切片（`assets/` 目录）。若曲库为空，服务端启动时会有相应提示。

---

## ✨ 游戏特性

- 🎯 **单机猜歌模式** —— 提供「简单」与「困难」双难度。困难模式下，选项全为同组合或相近曲名，极具挑战。
- ⚔️ **1v1 歌牌对决（空札領地戦）** —— 融合日本传统竞技歌牌玩法的双人抢牌对战！听伴奏抢先拍牌、送牌惩罚，还要时刻提防无对应牌的「空牌」陷阱。
- ⚡ **精准公平判定** —— 以客户端听到声音后的实际反应时间作为判定依据，消除网络波动与设备时延带来的不公平。
- 🔐 **完备的防作弊机制** —— 音频切片采用随机一次性 Token 下发，客户端无法提前获取题目答案或曲库全貌。
- 📱 **多端与局域网支持** —— 适配桌面端与移动端浏览器，支持局域网一键开黑，无需复杂配置。

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 20
- **pnpm** (推荐包管理器)
- **ffmpeg** (用于音频自动切片与格式转换)

### 快速上手步骤

```bash
# 1. 克隆项目并安装依赖
git clone https://github.com/Sallyn0225/shinycolors-song-guess.git
cd shinycolors-song-guess
pnpm install

# 2. 将自备的歌曲伴奏放入 songs/ 目录后，构建游戏曲库（切片/封面/索引）
pnpm assets all

# 3. 构建前端并启动服务
pnpm --filter @scg/web build
pnpm --filter @scg/server start
```

启动完成后，打开浏览器访问 [http://localhost:5179](http://localhost:5179) 即可开始游玩！

---

### 💻 本地开发

前后端热重载开发模式：

```bash
# 终端 1：启动后端服务 (Fastify + tsx watch)
pnpm --filter @scg/server dev

# 终端 2：启动前端页面 (Vite Dev Server)
pnpm --filter @scg/web dev
```

前端开发服务器将运行在 [http://localhost:5173](http://localhost:5173)，并自动代理后端请求与 WebSocket 连接。

---

### 🐳 部署指南

推荐使用 Docker Compose 快速完成生产环境部署：

```bash
# 1. 复制环境变量配置文件
cp .env.example .env
# 编辑 .env 配置你的域名或端口信息

# 2. 启动服务容器
docker compose up -d
```

更详细的部署说明、反向代理与 Nginx 配置建议，请参阅 [DEPLOY.md](DEPLOY.md)。

---

## 🏗️ 项目架构

本项目采用基于 pnpm workspace 的 Monorepo 结构：

| 模块目录 | 技术选型 | 主要职责 |
|---|---|---|
| `apps/web` | React 18 + Vite 6 + Tailwind CSS | 游戏前端界面与动效交互 |
| `apps/server` | Fastify 5 + WebSocket | 单机与联机房间管理、WebSocket 协议通信、音频下发与静态资源托管 |
| `packages/shared` | TypeScript | 前后端共用的数据结构、通信协议与全局配置常量 |
| `packages/game-core` | TypeScript | 抽题逻辑、计分规则、歌牌状态流转等纯函数业务核心 |
| `tools/prepare-audio` | Node.js + ffmpeg | 离线音频处理工具：伴奏切片、响度标准化、封面压缩与清单构建 |

---

## 📖 相关文档

- 🎨 **界面设计规范**：[DESIGN.md](DESIGN.md)
- 🚀 **完整部署说明**：[DEPLOY.md](DEPLOY.md)
- 👥 **参与贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- 🔒 **安全与漏洞反馈**：[SECURITY.md](SECURITY.md)

---

## 📄 许可证与致谢

- **代码部分**：采用 [MIT License](LICENSE) 开源。
- **素材与版权**：角色、语音与音乐素材版权归原版权方所有，详见 [NOTICE](NOTICE)。

---

<div align="center">

Made with ❤️ by 闪耀色彩制作人

</div>
