import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    redis: "src/redis/index.ts",
    webhooks: "src/webhooks/index.ts",
    proxy: "src/proxy/index.ts",
    game: "src/game/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  clean: true,
});
