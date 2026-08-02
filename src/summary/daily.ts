import { PrismaClient } from "@prisma/client";
import { PRODUCT_NAME } from "../lib/branding";

const prisma = new PrismaClient();
const SLACK_TIMEOUT_MS = 10_000;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function getMetric(metrics: any, key: string): number {
  if (!metrics || typeof metrics !== "object") return 0;
  return (metrics as Record<string, number>)[key] ?? 0;
}

async function sendSlackMessage(webhookUrl: string, text: string) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`Slack webhook failed: ${res.status} ${(await res.text()).slice(0, 1000)}`);
  }
}

export async function generateDailySummary() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600_000);

  // Get tweets from last 24h
  const recentTweets = await prisma.tweet.findMany({
    where: { fetchedAt: { gte: yesterday } },
    orderBy: { createdAt: "desc" },
  });

  if (recentTweets.length === 0) {
    console.log("No new tweets in last 24h");
    return "No new tweets in last 24h";
  }

  // Score tweets: bookmark*5 + like*2 + retweet*3 + view*0.001
  const scored = recentTweets.map((t) => {
    const m = t.metrics as any || {};
    const score =
      (m.bookmark || 0) * 5 +
      (m.like || 0) * 2 +
      (m.retweet || 0) * 3 +
      (m.view || 0) * 0.001;
    return { ...t, score, m };
  });

  scored.sort((a, b) => b.score - a.score);

  const top10 = scored.slice(0, 10);
  const dateStr = now.toISOString().slice(0, 10);

  // Build summary
  let summary = `📡 *${PRODUCT_NAME} — Daily Summary (${dateStr})*\n`;
  summary += `Collected ${recentTweets.length} tweets from ${new Set(recentTweets.map((t) => t.handle)).size} accounts\n\n`;
  summary += `*🏆 Top ${top10.length} by Engagement Score*\n`;
  summary += `_(score = bookmark×5 + like×2 + RT×3 + view×0.001)_\n\n`;

  top10.forEach((t, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const text = t.text.slice(0, 120).replace(/\n/g, " ");
    summary += `${medal} *@${t.handle}* ${t.isNote ? "📝" : ""}\n`;
    summary += `> ${text}${t.text.length > 120 ? "…" : ""}\n`;
    summary += `> 👁${formatNumber(t.m.view || 0)} ❤️${formatNumber(t.m.like || 0)} 🔖${formatNumber(t.m.bookmark || 0)} 🔄${formatNumber(t.m.retweet || 0)}\n`;
    summary += `> <${t.url}>\n\n`;
  });

  // Per-handle breakdown
  const handleCounts = new Map<string, number>();
  recentTweets.forEach((t) => handleCounts.set(t.handle, (handleCounts.get(t.handle) || 0) + 1));
  summary += `*📊 Per Account*\n`;
  for (const [handle, count] of [...handleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    summary += `• @${handle}: ${count} tweets\n`;
  }

  const dashboardUrl = process.env.SUMMARY_DASHBOARD_URL?.trim();
  if (dashboardUrl) {
    summary += `\n🔗 <${dashboardUrl}|View in dashboard>`;
  }

  // Send to Slack if webhook is configured
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    await sendSlackMessage(webhookUrl, summary);
    console.log("Summary sent to Slack");
  } else {
    console.log("SLACK_WEBHOOK_URL not set, printing summary:");
    console.log(summary);
  }

  await prisma.$disconnect();
  return summary;
}

// CLI entry
if (require.main === module) {
  generateDailySummary()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
