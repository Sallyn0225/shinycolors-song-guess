import { buildApp } from './app.js'
import { SERVER_CONFIG } from './config.js'

const app = await buildApp()

/**
 * keepAlive 超时必须**大于**上游反代的对应值。
 *
 * 反了会撞上一个很难查的竞态：代理复用一条 upstream 连接发新请求的同一瞬间，
 * Node 正好把它关掉，用户随机看到 502。nginx 默认 keepalive_timeout 是 75 秒，
 * 所以这里取 90，headersTimeout 再大一点。
 */
app.server.keepAliveTimeout = 90_000
app.server.headersTimeout = 95_000

await app.listen({ port: SERVER_CONFIG.port, host: SERVER_CONFIG.host })

process.stdout.write(`\n  服务已启动  http://localhost:${SERVER_CONFIG.port}\n`)
process.stdout.write(`  局域网访问   http://<本机IP>:${SERVER_CONFIG.port}\n`)
process.stdout.write(
  SERVER_CONFIG.webRoot
    ? `  前端         已一并托管（${SERVER_CONFIG.webRoot}）\n\n`
    : `  前端         未构建，请另跑 pnpm --filter @scg/web dev\n\n`,
)

// 反代/容器会发 SIGTERM。不优雅关闭的话，正在进行的对局会被硬切，
// 客户端只看到连接断开而拿不到任何说明
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void app.close().then(() => process.exit(0))
  })
}
