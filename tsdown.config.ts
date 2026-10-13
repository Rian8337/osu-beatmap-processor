import { cp } from "node:fs/promises";
import { builtinModules } from "node:module";
import { defineConfig } from "tsdown";

/**
 * Packages left out of the bundle. `pg` optionally requires `pg-native`, which is not installed.
 */
const externalPackages = ["pg-native"];

function isExternal(id: string): boolean {
    return (
        id.startsWith("node:") ||
        builtinModules.includes(id) ||
        externalPackages.some(
            (name) => id === name || id.startsWith(`${name}/`),
        )
    );
}

// `src/polyfills.ts` must be the first import of both entries: the bundler evaluates reflect-metadata lazily, so a
// later import lets tsyringe load before the Reflect polyfill exists.
export default defineConfig({
    entry: { index: "src/index.ts", cli: "src/cli.ts" },
    format: "esm",
    platform: "node",
    tsconfig: "tsconfig.build.json",
    outDir: "dist",
    clean: true,
    deps: {
        neverBundle: externalPackages,
        alwaysBundle: (id) => !isExternal(id),
        onlyBundle: false,
    },
    onSuccess: async () => {
        await cp("drizzle", "dist/drizzle", { recursive: true });
    },
});
