import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? '/fps-aim-arena/' : '/',
  build: {
    sourcemap: true
  }
});

