import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

/**
 * Extract slug from a Facebook URL.
 */
function extractSlug(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return url;
  }
}

/**
 * Detect source type from URL.
 */
function detectType(url: string): "group" | "page" {
  return url.includes("/groups/") ? "group" : "page";
}

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.fbSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { posts: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, url, type, tags } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Clean URL: remove query params like ?locale=ja_JP
  let cleanUrl = url.trim();
  try {
    const parsed = new URL(cleanUrl);
    parsed.search = "";
    cleanUrl = parsed.toString().replace(/\/+$/, "");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!cleanUrl.includes("facebook.com")) {
    return NextResponse.json({ error: "URL must be a Facebook URL" }, { status: 400 });
  }

  const existing = await prisma.fbSource.findUnique({ where: { url: cleanUrl } });
  if (existing) {
    return NextResponse.json({ error: "This Facebook source is already registered", source: existing }, { status: 409 });
  }

  const slug = extractSlug(cleanUrl);
  const sourceType = type || detectType(cleanUrl);
  const sourceName = name?.trim() || slug;

  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.fbSource.create({
    data: {
      name: sourceName,
      type: sourceType,
      url: cleanUrl,
      slug,
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

  const source = await prisma.fbSource.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.fbSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
