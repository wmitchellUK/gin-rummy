import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/server/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "src/game/test/**/*.test.ts",
            "src/server/test/**/*.test.ts",
            "src/shared/test/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          include: ["components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./components/test/setup.ts"],
        },
      },
    ],
  },
});
