import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Sample sources (public org accounts). Replace with your own list —
// see docs/operations.md for how to configure sources for your deployment.
const VIP_HANDLES = [
  "OpenAI",
  "AnthropicAI",
  "GoogleDeepMind",
];

const FB_SOURCES = [
  {
    name: "Example AI Group",
    type: "group",
    url: "https://www.facebook.com/groups/example-ai-group",
    slug: "example-ai-group",
    tags: ["ai", "example"],
  },
];

const REDDIT_SOURCES = [
  {
    name: "LocalLLaMA",
    subreddit: "LocalLLaMA",
    tags: ["ai", "llm"],
  },
  {
    name: "MachineLearning",
    subreddit: "MachineLearning",
    tags: ["ai", "ml"],
  },
  {
    name: "ClaudeAI",
    subreddit: "ClaudeAI",
    tags: ["ai", "claude"],
  },
  {
    name: "ChatGPT",
    subreddit: "ChatGPT",
    tags: ["ai", "gpt"],
  },
];

const QIITA_SOURCES = [
  { name: "ChatGPTタグ", tag: "ChatGPT" },
  { name: "LLMタグ", tag: "LLM" },
  { name: "Claudeタグ", tag: "Claude" },
  { name: "生成AIタグ", tag: "生成AI" },
  { name: "エージェントタグ", tag: "AIエージェント" },
];

const GH_SOURCES = [
  // Repo tracking (releases)
  { name: "Anthropic Cookbook", type: "repo", repo: "anthropics/anthropic-cookbook", tags: ["ai", "anthropic"] },
  { name: "Claude Code", type: "repo", repo: "anthropics/claude-code", tags: ["ai", "claude"] },
  { name: "OpenAI Codex", type: "repo", repo: "openai/codex", tags: ["ai", "openai"] },
  // Search queries (trending)
  { name: "AI Trending (Weekly)", type: "search", query: "topic:artificial-intelligence pushed:>2026-02-25 stars:>100", tags: ["ai", "trending"] },
  { name: "LLM Trending (Weekly)", type: "search", query: "topic:llm pushed:>2026-02-25 stars:>50", tags: ["llm", "trending"] },
];

async function main() {
  // Seed X sources
  for (const handle of VIP_HANDLES) {
    await prisma.source.upsert({
      where: { handle },
      create: { handle },
      update: {},
    });
    console.log(`Upserted source: @${handle}`);
  }

  // Seed Facebook sources
  for (const fb of FB_SOURCES) {
    await prisma.fbSource.upsert({
      where: { url: fb.url },
      create: fb,
      update: { name: fb.name, tags: fb.tags },
    });
    console.log(`Upserted FB source: ${fb.name} (${fb.type}: ${fb.slug})`);
  }

  // Seed Reddit sources
  for (const reddit of REDDIT_SOURCES) {
    await prisma.redditSource.upsert({
      where: { subreddit: reddit.subreddit },
      create: reddit,
      update: { name: reddit.name, tags: reddit.tags },
    });
    console.log(`Upserted Reddit source: ${reddit.name} (r/${reddit.subreddit})`);
  }

  // Seed Qiita sources
  for (const qiita of QIITA_SOURCES) {
    await prisma.qiitaSource.upsert({
      where: { tag: qiita.tag },
      create: qiita,
      update: { name: qiita.name },
    });
    console.log(`Upserted Qiita source: ${qiita.name} (#${qiita.tag})`);
  }

  // Seed GitHub sources
  for (const gh of GH_SOURCES) {
    if (gh.type === "repo") {
      const existing = await prisma.ghSource.findFirst({
        where: { type: "repo", repo: gh.repo },
      });
      if (!existing) {
        await prisma.ghSource.create({
          data: {
            name: gh.name,
            type: gh.type,
            repo: gh.repo,
            tags: gh.tags || [],
          },
        });
        console.log(`Created GH source: ${gh.name} (${gh.repo})`);
      } else {
        await prisma.ghSource.update({
          where: { id: existing.id },
          data: { name: gh.name, tags: gh.tags || [] },
        });
        console.log(`Updated GH source: ${gh.name} (${gh.repo})`);
      }
    } else if (gh.type === "search") {
      const existing = await prisma.ghSource.findFirst({
        where: { type: "search", query: gh.query },
      });
      if (!existing) {
        await prisma.ghSource.create({
          data: {
            name: gh.name,
            type: gh.type,
            query: gh.query,
            tags: gh.tags || [],
          },
        });
        console.log(`Created GH source: ${gh.name} (search)`);
      } else {
        await prisma.ghSource.update({
          where: { id: existing.id },
          data: { name: gh.name, tags: gh.tags || [] },
        });
        console.log(`Updated GH source: ${gh.name} (search)`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
