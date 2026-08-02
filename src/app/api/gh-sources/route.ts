import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

/**
 * Extract owner/repo from a GitHub URL or return as-is.
 */
function extractRepo(input: string): string {
  try {
    const match = input.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) return match[1];
    return input.trim();
  } catch {
    return input.trim();
  }
}

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.ghSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, type, repo, query, tags } = await req.json();
  
  if (!type || !["repo", "search"].includes(type)) {
    return NextResponse.json({ error: "type must be 'repo' or 'search'" }, { status: 400 });
  }

  if (type === "repo" && (!repo || typeof repo !== "string")) {
    return NextResponse.json({ error: "repo is required for type 'repo'" }, { status: 400 });
  }

  if (type === "search" && (!query || typeof query !== "string")) {
    return NextResponse.json({ error: "query is required for type 'search'" }, { status: 400 });
  }

  const cleanRepo = type === "repo" ? extractRepo(repo) : null;
  
  // Check for existing source
  if (type === "repo" && cleanRepo) {
    const existing = await prisma.ghSource.findFirst({
      where: { type: "repo", repo: cleanRepo },
    });
    
    if (existing) {
      return NextResponse.json(
        { error: "This GitHub repo source is already registered", source: existing },
        { status: 409 }
      );
    }
  }

  const sourceName = name?.trim() || (type === "repo" ? cleanRepo : "GitHub Search");

  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.ghSource.create({
    data: {
      name: sourceName,
      type,
      repo: cleanRepo,
      query: type === "search" ? query?.trim() : null,
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

  const source = await prisma.ghSource.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.ghSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}