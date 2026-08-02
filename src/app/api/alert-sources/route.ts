import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";
import { validateSafeHttpUrl } from "@/lib/net/safe-fetch";

const prisma = new PrismaClient();

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.alertSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, feedUrl, tags } = await req.json();
  if (!name || !feedUrl) {
    return NextResponse.json({ error: "name and feedUrl are required" }, { status: 400 });
  }

  const cleanUrl = feedUrl.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch {
    return NextResponse.json({ error: "feedUrl must be a valid URL" }, { status: 400 });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return NextResponse.json({ error: "feedUrl must be a valid URL" }, { status: 400 });
  }

  try {
    await validateSafeHttpUrl(parsedUrl, { timeoutMs: 15_000 });
  } catch {
    return NextResponse.json({ error: "feedUrl must be a valid URL" }, { status: 400 });
  }

  const existing = await prisma.alertSource.findUnique({ where: { feedUrl: cleanUrl } });
  if (existing) {
    return NextResponse.json({ error: "Feed URL already exists", source: existing }, { status: 409 });
  }

  const source = await prisma.alertSource.create({
    data: {
      name: name.trim(),
      feedUrl: cleanUrl,
      tags: Array.isArray(tags) ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean) : [],
    },
  });
  return NextResponse.json({ source }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id, active, tags, name, fetchIntervalHours, maxItemsPerFetch } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data: any = {};
  if (typeof active === "boolean") data.active = active;
  if (typeof name === "string") data.name = name.trim();
  if (typeof fetchIntervalHours === "number") data.fetchIntervalHours = fetchIntervalHours;
  if (typeof maxItemsPerFetch === "number") data.maxItemsPerFetch = maxItemsPerFetch;
  if (Array.isArray(tags)) {
    data.tags = tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
  }

  const source = await prisma.alertSource.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.alertSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
