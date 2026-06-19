import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 绑定 IPv4 回环。否则 Vite 只监听 IPv6 [::1]，浏览器通常先尝试 IPv4
    // 127.0.0.1，配合 Clash TUN 模式会有约 2 秒连接超时后才回退。
    host: '127.0.0.1',
    watch: {
      // 关键修复：asset/ 下约 9 万个文件（~2GB 示例文件）。若让文件监听器递归
      // 扫描它，每次 npm run dev 后首个请求会被后台扫描的磁盘 IO 拖住 ~30 秒。
      ignored: ['**/asset/**'],
    },
  },
})
