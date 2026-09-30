// Optional distribution build: one self-contained HTML file in dist-single/.
// See CLAUDE.md section 16. This config never influences how source is organised.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
