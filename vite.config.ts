import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [react(), {
    name: 'release',
    transformIndexHtml(html) {
      return html.replace('</head>', `<meta name="orgo-release" content="${process.env.VITE_ORGO_RELEASE ?? 'development'}"/></head>`);
    },
  }],
  build: { sourcemap: false },
});
