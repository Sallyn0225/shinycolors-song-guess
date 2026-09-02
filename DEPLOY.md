# 部署

> ⚠️ **版权**：切片是 1.7GB 商用音源的派生物。**代码是公开的，曲库不是**——
> `songs/` 与 `assets/` 都不入库、不分发，部署者需自备音源在本地构建（见 [NOTICE](NOTICE)）。
> 这也意味着**你的实例暴露给谁，是你自己的判断**：一旦公开部署，任何拿到网址的人
> 都能听到那些派生物。下文凡说「公网部署」，指的都是这个知情选择，不是一个技术细节。

局域网开黑不需要看这篇，`pnpm --filter @scg/server start` + `pnpm --filter @scg/web dev` 就够了。

---

## Docker Compose 部署

一台 2C4G / 5Mbps / 60G 的 VPS 足够。**瓶颈是带宽，不是 CPU。**

### 只有两样东西需要上服务器

```
仓库代码（git clone，或只要 docker-compose.yml + Caddyfile + .env）
assets/    216MB，本地构建好之后传上去
```

**`songs/` 绝对不要传。** 1.7GB 的源音源，服务端根本不读它 ——
`assets/` 已经是它的派生物。同理不要传的还有 `emoji/`、`opening-greeting/`、
`bg-video.mp4`、`design-extract-output/`：全是本地素材源文件，
入库的都已经是转好的成品。

### 首次部署

```bash
# ── 本地 ──
pnpm assets all                       # 构建曲库，需要 songs/ 里有音源

# 传曲库。Windows 没有 rsync 就用 scp（或在 WSL 里用 rsync）
scp -r assets sallyn0225@<VPS>:/opt/scg/assets
# rsync 可用时更好，断点续传且能增量：
# rsync -avz --progress assets/ sallyn0225@<VPS>:/opt/scg/assets/

# ── VPS ──
cd /opt/scg
git clone <repo> . && cp .env.example .env
vim .env                              # 填 DOMAIN 与 ACME_EMAIL
docker compose up -d
docker compose ps                     # app 应当是 healthy
```

`healthy` 的判定打的是 `/api/health`，它返回曲目数 ——
**所以健康就等于曲库确实挂上了**。忘了传 `assets/` 时容器会明确不健康，
而不是起来了却是个空壳。

### 更新

镜像由 GitHub Actions 构建并推到 GHCR，VPS 只负责拉：

```bash
docker compose pull && docker compose up -d
```

在 VPS 上跑 `pnpm install` + `vite build` 也能work，但那意味着每次部署
都要在 5Mbps 的线上拉一遍上百 MB 的依赖。交给 Actions 更划算。

### 回滚

```bash
docker compose down
APP_IMAGE=ghcr.io/<owner>/<repo>:<上一个 sha> docker compose up -d
```

镜像按 commit sha 打了 tag，回滚就是换一个 tag 重起。
**曲库不受影响** —— 它是挂载进去的，不在镜像里。

### 几个容易踩的点

- **`assets/` 是只读挂载**（`:ro`）。服务端只读不写，这是免费的加固。
- **`app` 不映射端口到宿主机。** 比设 `HOST=127.0.0.1` 更彻底 ——
  端口根本不进宿主机的网络命名空间，只有同一个 compose 网络里的 caddy 连得上。
- **`TRUST_PROXY=1` 已在 compose 里设好。** 不设的话按 IP 的房间配额会退化成
  全局配额，不报错，表现是「几个人一起玩时有人建不了房」。
- **Caddy 的证书目录是命名卷。** 不持久化的话每次重启都重新申请，
  很快撞上 Let's Encrypt 的速率限制然后彻底签不出来。
- **Caddyfile 里没有 `encode`，这是故意的。** 压缩在应用层做
  （`apps/server/src/app.ts`），因为局域网开黑那种形态根本没有反代。

### 境内 VPS

域名**必须已备案**，否则 80/443 会被拦，Caddy 也就签不出证书。

---

## 单进程模式（推荐）

构建前端后，服务端会一并托管它——**页面和 `/ws` 同源同端口**：

```bash
pnpm --filter @scg/web build     # → apps/web/dist
pnpm --filter @scg/server start
```

同源不只是省事。前端里 WS 的协议是跟着页面走的：

```ts
const proto = location.protocol === 'https:' ? 'wss' : 'ws'
new WebSocket(`${proto}://${location.host}/ws`)
```

页面是 https 就自动 wss。**分成两个源部署是绝大多数「本地好好的，一上线连不上」的根因**——
https 页面里发 `ws://` 会被浏览器直接拦掉，而且不报网络错误，只报一个语焉不详的安全错误。

启动时会打印前端是否已托管；显示「未构建」就说明 `apps/web/dist` 不存在，此时是纯 API 模式。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5179` | |
| `HOST` | `0.0.0.0` | 走反代时**建议改成 `127.0.0.1`**，别让端口直接暴露 |
| `TRUST_PROXY` | 关 | 反代后面才开。**直接暴露时开了它，任何人都能伪造 `X-Forwarded-For`** |
| `WEB_ROOT` | `apps/web/dist` | 前端产物目录 |
| `WS_HEARTBEAT_MS` | `25000` | 协议级心跳间隔 |

### 房间配额

只在**开放公网部署**时需要调；局域网开黑用默认值即可。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MAX_ROOMS` | `200` | 全局同时存在的房间数上限（总闸）。**设成 `0` 即临时关停建房**，不用改代码 |
| `MAX_PUBLIC_ROOMS` | 跟随 `MAX_ROOMS` | 公开房间数上限。设成 `0` 即只关公开房 |
| `MAX_PRIVATE_ROOMS` | 跟随 `MAX_ROOMS` | 私人房间数上限。设成 `0` 与 `ALLOW_PRIVATE_ROOMS=0` 等价 |
| `ALLOW_PRIVATE_ROOMS` | `1` | 设成 `0` 即本实例不开私人房。大厅建房弹窗里私人选项会置灰 |
| `MAX_ROOMS_PER_IP` | `5` | 单 IP 同时持有的房间数 |
| `CREATE_PER_MIN` | `15` | 单 IP 每分钟建房次数 |
| `JOIN_FAIL_PER_MIN` | `20` | 单 IP 每分钟**加入失败**次数。这是私人房间不被枚举的保障 |
| `WAITING_TTL_MS` | `900000` | 等待中的房间没人加入的存活上限（15 分钟），到点通知房主并关闭 |
| `ABANDONED_TTL_MS` | `65000` | 全员掉线房间清扫兜底时长（正常情况下全员离线会立刻回收，此处仅兜底异常脱机路径） |

三个新变量的默认值都**跟随 `MAX_ROOMS` 的实际取值**：只把 `MAX_ROOMS` 调到 50，
公开/私人两类上限也各自是 50 —— 行为与只配一个总闸完全一致。

**建议 `MAX_ROOMS >= MAX_PUBLIC_ROOMS + MAX_PRIVATE_ROOMS`。** 建房要过三道闸：
总数、该类上限、个人配额。总闸小于两类上限之和时，会出现「两类都没满、
个人配额也没超，却建不了房」的情况 —— 那是总闸先到顶了，错误信息是「服务器房间已满」。
大厅显示的分母已自动取 `min(分类上限, MAX_ROOMS)`，不会展示一个实际达不到的数字，
但配置本身保持自洽可以少一层解释成本。

---

## 开放公网部署

房间列表让**任何拿到网址的人**都能看到并加入公开房间。这比「知道房间码才进得来」的
暴露面大得多，上线前有三件事必须确认。

### 1. 版权：这一步是有代价的

本文开头那条警告在这里加倍适用。开着房间列表，和只发房间码，暴露面差了一个量级：
后者至少要求对方先从你这里拿到点什么，前者只要求他知道网址。
**能听到那些派生物的人，从「你发了码的朋友」变成了「任何人」。**

如果你只想给朋友玩，最省事的办法是在 Caddy 上加一道 basic auth：

```caddy
karuta.example.com {
  basicauth {
    friend $2a$14$...          # caddy hash-password 生成
  }
  reverse_proxy 127.0.0.1:5179 { ... }
}
```

### 2. `TRUST_PROXY=1` 不是可选的

按 IP 的三项配额（`MAX_ROOMS_PER_IP` / `CREATE_PER_MIN` / `JOIN_FAIL_PER_MIN`）
全靠 `req.ip`。**不开 `TRUST_PROXY` 时它是反代自己的地址**，于是所有玩家挤进同一个配额桶：
配额从「每人 5 个房间」退化成「全站 5 个房间」。

不会有报错，表现是「几个人一起玩的时候，有人建不了房」。

### 3. NAT 会误伤

反过来，开了 `TRUST_PROXY` 也不代表一人一桶：**同一个宿舍 / 办公室 / 家庭出口的所有玩家
共享一个公网 IP**，在服务端看来就是同一个人。默认的 `MAX_ROOMS_PER_IP=5` 是
「几个朋友同时开房」和「挡住刷房」之间的折中；如果你的玩家集中在同一个出口，调大它。

### 房间的生命周期

没有数据库，房间全在内存里，**服务重启即全部消失**。自动回收机制：

| 情况 | 何时回收 |
|---|---|
| 全员离线（一条活连接都不剩） | **立刻回收**，座位凭证同时作废；`ABANDONED_TTL_MS`（默认 65 秒）作为异常脱机时的清扫兜底 |
| 建了房一直没人来 | `WAITING_TTL_MS`（默认 15 分钟），房主会收到通知 |

---

## 反向代理

### 三条不能漏的

**1. 必须转发 `Upgrade` / `Connection` 头。** 漏了 WebSocket 握手会变成普通 GET，
表现是连接立刻关闭、控制台只有一句 `WebSocket connection failed`，看不出原因。

**2. `proxy_read_timeout` 必须大于心跳间隔。** 对局里两次**业务消息**之间最长有 60 秒空隙
（记忆阶段），单靠业务流量正好顶到 nginx 的 60 秒默认值。真正兜住它的是服务端每 25 秒
一次的协议级 ping（`app.ts` 里的 `setInterval`，与对局阶段无关，不管牌面上在发生什么都照发），
所以门槛是 **25 秒**而不是记忆阶段时长——把读超时放到 **120 秒**留足余量。
超时会被代理静默切断，玩家看到的是随机掉线。

**3. 关掉响应缓冲。** `proxy_buffering off`，否则代理会攒够一批才发，
起播指令被推迟几百毫秒，两端听到的时刻就对不齐了。

### nginx

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl http2;
  server_name karuta.example.com;

  ssl_certificate     /etc/letsencrypt/live/karuta.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/karuta.example.com/privkey.pem;

  # 切片 ~150KB/回合，默认 1M 够用；这里主要是别让上传体积被限死
  client_max_body_size 1m;

  location / {
    proxy_pass http://127.0.0.1:5179;
    proxy_http_version 1.1;

    # ① WebSocket 握手
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # ② 读超时 > 心跳间隔
    proxy_read_timeout  120s;
    proxy_send_timeout  120s;

    # ③ 关缓冲，起播时刻才准
    proxy_buffering off;
  }
}
```

配套的 `TRUST_PROXY=1`，服务端才会认这些 `X-Forwarded-*`。

> **nginx 默认 ETag 是 `inode-size-mtime`。** 对切片无所谓（切片走 `no-store`，
> 而且根本不经 `try_files`），但如果你把 `assets/` 直接挂成静态目录，
> 记得 `etag off` 或换内容哈希——mtime 一泄漏，按时间排一遍就能还原「切片 ↔ 曲目」对照表。
> 构建流程已经把全部产物的 mtime 统一成同一个常量，这条主要是提醒别在代理层又把它加回来。

### Caddy

Caddy 自动处理 upgrade 和证书，配置短得多：

```caddy
karuta.example.com {
  reverse_proxy 127.0.0.1:5179 {
    flush_interval -1        # 关缓冲，等价于 proxy_buffering off
    transport http {
      read_timeout 120s
    }
  }
}
```

---

## CDN

**线上（283guess.hmhnk.top）是整站挂 EdgeOne 的形态**：页面、图片、音频都随站走
边缘缓存，没有独立的资源前缀，也没有需要配置的环境变量。

图片（`/thumb/<id>.webp`）不可变、带长缓存头、也不含任何答案线索，路径由前端按
songId 写死（答题选项、揭晓槽、结算、分享卡四处同一句拼法），随站走 CDN 即可，
无需额外动作。留在 VPS 由本进程伺服在当前体量下也没有代价：全部 243 张
共 1.9MB、单张 ~8KB，且带长缓存头，玩家重复访问不重复下载。

**切片绝对不能走 CDN。** 三个理由，任何一个都是硬伤：

1. clip token 是**一次性**的、每局重新生成，必须由服务进程校验。放 CDN 上等于取消这层校验，
   谁都能反复下载
2. CDN 会缓存。而切片故意发 `no-store`——缓存命中与否的时间差本身就是一条弱旁路
3. 批量预下载全部 1404 个切片、离线建对照表，是这个游戏原理上唯一挡不住的攻击。
   让它必须经过自己的服务器，至少这件事在日志里是**显眼**的

---

## AAC 兜底（老 Safari）

Safari **18.4（2025-03）以前**，Ogg 和 WebM 两种容器的 Opus 都放不了——选哪个都救不了老版本。
要支持就得额外生成一份 AAC：

```bash
pnpm assets slice --with-aac-fallback
pnpm assets manifest
```

代价：构建时间 +30% 左右，磁盘多约 290MB。

生成后 `manifest` 会打印「AAC 兜底：已就位」，服务端随之在 `roundArm` 里下发 `fallbackUrl`，
单机模式的 session 响应里 `aacFallback` 变成 `true`。客户端**先试 Opus，解不了才换 AAC**，
并记住结果，之后直接走兜底。

> 不能用 `canPlayType` 提前判断——**iOS 上它会说谎**。只能真解一次看它成不成。

没生成时服务端不会下发 `fallbackUrl`，客户端也就不会去试。报了却不存在比不报还糟：
老 Safari 会拿到 404，然后彻底没声音。

---

## 检查清单

上线后逐条过一遍：

- [ ] 页面是 https，DevTools 的 Network → WS 里那条连接是 **wss**
- [ ] 建房、进房、开局跑通；把手机切到 4G（不同网络）再进一次
- [ ] 开放部署才需要：`TRUST_PROXY=1` 已设（否则按 IP 的配额会退化成全局配额）
- [ ] 建一个**公开**房，另一台设备的大厅列表里看得到；建一个**私人**房，列表里看不到
- [ ] 私人房的房间码在另一台设备上输得进去
- [ ] 记忆阶段挂满 60 秒不掉线（这一步专门验 `proxy_read_timeout`）
- [ ] 断网 10 秒再恢复：应当自动重连并接回牌面，而不是回到首页
- [ ] 刷新页面：应当出现「点击继续对局」，点完能听到下一回合的声音
- [ ] Network 面板里搜曲名，**搜不到任何一个**；clip 请求的响应头是 `no-store`
- [ ] 切片响应**没有 `Last-Modified`**
- [ ] 用 DevTools 限速到 Slow 3G 打一局：判定仍按反应时间，不按到达时间

## 备份与轮换

`assets/` 是构建产物，可以随时从 `songs/` 重建，不需要备份。

想打断攻击者积累的对照表就轮换 sliceId——**只是一次 rename，不重新编码**：

```bash
pnpm assets slice --rotate-ids
pnpm assets manifest
```
