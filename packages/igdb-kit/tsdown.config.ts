import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    redis: "src/redis/index.ts",
    webhooks: "src/webhooks/index.ts",
    proxy: "src/proxy/index.ts",
    game: "src/game/index.ts",
    i18n: "src/i18n/index.ts",
    "i18n/fr": "src/i18n/fr.ts",
    "i18n/de": "src/i18n/de.ts",
    "i18n/es": "src/i18n/es.ts",
    "i18n/pt-BR": "src/i18n/pt-BR.ts",
    "i18n/pl": "src/i18n/pl.ts",
    "i18n/ru": "src/i18n/ru.ts",
    "i18n/ja": "src/i18n/ja.ts",
    "i18n/zh-CN": "src/i18n/zh-CN.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  clean: true,
});
