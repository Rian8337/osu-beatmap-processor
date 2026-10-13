import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { alias: { "@": "/src", "@test": "/tests" } },
    test: {
        include: ["tests/e2e/**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        testTimeout: 60_000,
        hookTimeout: 180_000,
        maxWorkers: 1,
    },
});
