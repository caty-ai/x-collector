import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

/**
 * Extract subreddit name from a Reddit URL or return as-is if already a name.
 */
function extractSubreddit(input: string): string {
  try {
    const match = input.match(/(?:reddit\.com\/)?r\/([a-zA-Z0-9_]+)/);
    if (match) return match[1];
    // If no /r/ pattern, assume it's already the subreddit name
    return input.trim().replace(/^r\//, "");
  } catch {
    return input.trim();
  }
}

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.redditSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { posts: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, subreddit, tags } = await req.json();
  
  if (!subreddit || typeof subreddit !== "string") {
    return NextResponse.json({ error: "subreddit is required" }, { status: 400 });
  }

  const cleanSubreddit = extractSubreddit(subreddit).toLowerCase();
  
  if (!cleanSubreddit) {
    return NextResponse.json({ error: "Invalid subreddit" }, { status: 400 });
  }

  const existing = await prisma.redditSource.findUnique({
    where: { subreddit: cleanSubreddit },
  });
  
  if (existing) {
    return NextResponse.json(
      { error: "This Reddit source is already registered", source: existing },
      { status: 409 }
    );
  }

  const sourceName = name?.trim() || cleanSubreddit;

  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.redditSource.create({
    data: {
      name: sourceName,
      subreddit: cleanSubreddit,
      active: true,
      tags: cleanTags,
    },
  });

  return NextResponse.json({ source }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id, active, tags, name } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data: any = {};
  if (typeof active === "boolean") data.active = active;
  if (typeof name === "string") data.name = name.trim();
  if (Array.isArray(tags)) {
    data.tags = tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
  }

  const source = await prisma.redditSource.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.redditSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
