import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // 处理核心：纯函数的单元测试，以及用真实 FFmpeg 验证每项功能效果的集成测试
        test: {
          name: 'core',
          include: ['tests/core/**/*.test.ts'],
          globalSetup: ['tests/setup/fixtures.ts'],
          testTimeout: 180_000,
        },
      },
      {
        // 界面：用 Playwright 启动构建好的程序（需要先执行 pnpm build）
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          globalSetup: ['tests/setup/fixtures.ts'],
          testTimeout: 180_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
