import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        pool: "threads",
        maxThreads: 1,
        minThreads: 1,
    },
});
