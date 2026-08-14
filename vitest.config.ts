import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    env: {
      CLASSIFY_MODEL: "vitest-classify-model",
      CROSSLINK_LLM_MODEL: "vitest-crosslink-fallback-model",
      DIGEST_API_KEY: "",
      FEED_API_KEY: "",
      MCP_SELF_BASE_URL: "http://127.0.0.1:3300",
      PORT: "3300",
      NEWSLETTER_API_KEY: "",
      NEWSPAPER_MASTHEAD: "AI Daily News",
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "vitest-or",
      PRODUCT_NAME: "X Collector",
      PRODUCT_SLUG: "x-collector",
      STEP4_CROSSLINK_LLM_MODEL: "vitest-crosslink-model",
      STEP4_CROSSLINK_LIMIT: "600",
      STEP5_COMPOSE_DENSE_SECTION_MIN_CANDIDATES: "3",
      STEP5_COMPOSE_DENSITY_RETRY_MAX: "1",
      STEP5_COMPOSE_MIN_ITEMS_PER_DENSE_SECTION: "3",
      STEP5_COMPOSE_MODEL: "vitest-compose-model",
      STEP5_PUBLISH_LIMIT: "120",
      STEP5_SCRIPT_MAX_PER_SECTION: "0",
      STEP5_SCRIPT_SUMMARY_MAX_CHARS: "220",
      STEP_GITHUB_REPO_DEDUP_ENABLED: "false",
      STEP_HEADLINE_CLUSTER_BETA: "8",
      STEP_HEADLINE_CLUSTER_GAMMA: "0.5",
      STEP_LOCALIZE_JA: "false",
      STEP_TOPIC_CLUSTER_ENABLED: "false",
      UA_CONTACT: "+https://github.com/caty-ai/x-collector",
    },
    // Keep src/scripts/community/no-auto-subscribe.test.ts out of Vitest: it uses assert/strict + spawnSync + PrismaClient and needs DATABASE_URL.
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
