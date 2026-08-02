import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

function extractHandle(raw: string): string {
  let h = raw.trim();
  // Strip URL prefixes
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\/@?/i, "");
  // Strip leading @
  h = h.replace(/^@/, "");
  // Strip trailing slash
  h = h.replace(/\/.*$/, "");
  return h.toLowerCase();
}

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.igSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { posts: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { name, handle, tags } = await req.json();

  if (!handle || typeof handle !== "string") {
    return NextResponse.json({ error: "handle is required" }, { status: 400 });
  }

  const cleanHandle = extractHandle(handle);
  if (!cleanHandle) {
    return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
  }

  const existing = await prisma.igSource.findUnique({
    where: { handle: cleanHandle },
  });

  if (existing) {
    return NextResponse.json(
      { error: "This Instagram source is already registered", source: existing },
      { status: 409 }
    );
  }

  const sourceName = name?.trim() || cleanHandle;
  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.igSource.create({
    data: { name: sourceName, handle: cleanHandle, tags: cleanTags },
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
  if (Array.isArray(tags))
    data.tags = tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);

  const updated = await prisma.igSource.update({ where: { id }, data });
  return NextResponse.json({ source: updated });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await prisma.igPost.deleteMany({ where: { sourceId: id } });
  await prisma.igSource.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
