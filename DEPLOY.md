# 部署

> ⚠️ **版权**：切片是 1.7GB 商用音源的派生物。仓库保持私有，**不要公开部署到不受控的公网**。
> 下文说的「公网」指的是自建的、只发给朋友的私有实例。

局域网开黑不需要看这篇，`pnpm --filter @scg/server start` + `pnpm --filter @scg/web dev` 就够了。

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
| `PUBLIC_ASSET_BASE` | 空 | 封面/缩略图的 CDN 前缀。**切片不适用，见下** |
| `WS_HEARTBEAT_MS` | `25000` | 协议级心跳间隔 |

---

## 反向代理

### 三条不能漏的

**1. 必须转发 `Upgrade` / `Connection` 头。** 漏了 WebSocket 握手会变成普通 GET，
表现是连接立刻关闭、控制台只有一句 `WebSocket connection failed`，看不出原因。

**2. `proxy_read_timeout` 必须大于心跳间隔。** 默认 60 秒，而对局里两次业务消息之间
最长可能有十几秒空隙（记忆阶段 30 秒尤其明显）。超时会被代理静默切断，玩家看到的是随机掉线。
服务端有 25 秒的协议级心跳，把读超时放到 **120 秒**留足余量。

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

**封面和缩略图可以走 CDN**，它们不可变、已经带长缓存头、也不含任何答案线索：

```bash
PUBLIC_ASSET_BASE=https://cdn.example.com pnpm --filter @scg/server start
```

服务端下发的 `coverUrl` 会带上这个前缀。把 `assets/cover` 和 `assets/thumb` 同步上去即可。

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
- [ ] 记忆阶段挂满 30 秒不掉线（这一步专门验 `proxy_read_timeout`）
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
