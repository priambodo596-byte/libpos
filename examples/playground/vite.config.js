import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return undefined;
          if (normalized.includes('/pdf-lib/')) return 'pdf-engine';
          if (normalized.includes('/jszip/')) return 'docx-zip';
          if (normalized.includes('/@tiptap/') || normalized.includes('/prosemirror-')) return 'editor-runtime';
          if (normalized.includes('/@floating-ui/')) return 'ui-runtime';
          const match = normalized.match(/\/node_modules\/\.pnpm\/([^/]+)\//);
          if (!match) return undefined;
          const packageName = match[1].replace(/@[^@]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
          return `vendor-${packageName}`;
        },
      },
    },
  },
});
