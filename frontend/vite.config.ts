import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// إعدادات التطوير: الاستماع على كل الواجهات ليعمل المعاينة،
// والسماح بأي host (بيئة المعاينة تمر عبر نطاق وسيط).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    headers: { 'Cache-Control': 'no-store' },
    // طلبات /api تمر عبر نفس الأصل فتصل الكوكي httpOnly بدون CORS إطلاقاً
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
