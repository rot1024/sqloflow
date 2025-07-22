import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'sqloflow',
      fileName: (format) => `sqloflow.${format}.js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // Exclude external dependencies
      external: ['node-sql-parser'],
      output: {
        // Global variables for UMD builds
        globals: {
          'node-sql-parser': 'sqlParser'
        }
      }
    },
    sourcemap: true,
    minify: false, // Keep readability for library
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli.ts', 'src/cli.test.ts'],
    })
  ],
});