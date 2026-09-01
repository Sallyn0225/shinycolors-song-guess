import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env['API_TARGET'] ?? 'http://localhost:5179'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 监听所有网卡，方便局域网用手机开
    host: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/thumb': { target: API_TARGET, changeOrigin: true },
      // WebSocket 代理必须显式开 ws，否则 upgrade 请求不会被转发
      '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
})
