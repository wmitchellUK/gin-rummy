import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/game/test/**/*.test.ts"],
    environment: "node",
  },
});
