import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

/**
 * Extract tag name from a Qiita URL or return as-is if already a tag.
 */
function extractTag(input: string): string {
  try {
    const match = input.match(/qiita\.com\/tags\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // If no URL pattern, assume it's already the tag name
    return input.trim();
  } catch {
    return input.trim();
  }
}

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.qiitaSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, tag, tags } = await req.json();
  
  if (!tag || typeof tag !== "string") {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  const cleanTag = extractTag(tag);
  
  if (!cleanTag) {
    return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
  }

  const existing = await prisma.qiitaSource.findUnique({
    where: { tag: cleanTag },
  });
  
  if (existing) {
    return NextResponse.json(
      { error: "This Qiita tag is already registered", source: existing },
      { status: 409 }
    );
  }

  const sourceName = name?.trim() || cleanTag;

  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.qiitaSource.create({
    data: {
      name: sourceName,
      tag: cleanTag,
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

  const source = await prisma.qiitaSource.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.qiitaSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}