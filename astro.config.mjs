import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kbxai.github.io',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !page.includes('/preview/') })],
  build: { inlineStylesheets: 'always' },
  vite: {
    build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  },
});
