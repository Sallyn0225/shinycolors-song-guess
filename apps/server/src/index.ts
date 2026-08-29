import { buildApp } from './app.js'

const PORT = Number(process.env['PORT'] ?? 5179)
// 默认监听所有网卡，方便局域网开黑
const HOST = process.env['HOST'] ?? '0.0.0.0'

const app = await buildApp()
await app.listen({ port: PORT, host: HOST })

process.stdout.write(`\n  服务已启动  http://localhost:${PORT}\n`)
process.stdout.write(`  局域网访问   http://<本机IP>:${PORT}\n\n`)
