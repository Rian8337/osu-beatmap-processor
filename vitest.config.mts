import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { alias: { "@": "/src", "@test": "/tests" } },
    test: {
        include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        // At most two test threads, so a test run never exhausts the machine.
        maxWorkers: 2,
        silent: "passed-only",
        passWithNoTests: true,
        // Undo vi.spyOn spies (e.g. on console) after each test.
        restoreMocks: true,
        coverage: {
            provider: "v8",
            include: ["src/**"],
            reportsDirectory: "./coverage",
        },
    },
});
