import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  const isCliMode = mode === 'cli';
  const isDemoMode = mode === 'demo';

  if (isDemoMode) {
    // Demo site build configuration
    return {
      base: '/sqloflow/',
      build: {
        outDir: 'dist-demo',
        emptyOutDir: true
      }
    };
  }

  return {
    build: isCliMode ? {
      // CLI build configuration
      lib: {
        entry: resolve(__dirname, 'src/cli.ts'),
        formats: ['es'],
        fileName: () => 'cli.js'
      },
      rollupOptions: {
        external: [
          'node-sql-parser',
          'fs',
          'path',
          'process',
          'buffer',
          'stream',
          'util',
          'url',
          'module'
        ]
      },
      sourcemap: true,
      minify: false,
      outDir: 'dist',
      emptyOutDir: false
    } : {
      // Library build configuration
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'sqloflow',
        fileName: (format) => `sqloflow.${format}.js`,
        formats: ['es', 'cjs']
      },
      rollupOptions: {
        external: ['node-sql-parser'],
        output: {
          globals: {
            'node-sql-parser': 'sqlParser'
          }
        }
      },
      sourcemap: true,
      minify: false,
      outDir: 'dist',
      emptyOutDir: true
    },
    plugins: isCliMode ? [] : [
      dts({
        insertTypesEntry: true,
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/cli.ts', 'src/cli.test.ts'],
      })
    ],
  };
});