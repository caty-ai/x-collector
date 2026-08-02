import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

export async function GET() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const sources = await prisma.source.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { handle, tags } = await req.json();
  if (!handle || typeof handle !== "string") {
    return NextResponse.json({ error: "handle is required" }, { status: 400 });
  }

  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  if (!clean || clean.length > 50) {
    return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
  }

  const existing = await prisma.source.findUnique({ where: { handle: clean } });
  if (existing) {
    return NextResponse.json({ error: `@${clean} is already registered` }, { status: 409 });
  }

  const cleanTags = Array.isArray(tags)
    ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const source = await prisma.source.create({
    data: { handle: clean, type: "vip_handle", active: true, tags: cleanTags },
  });

  return NextResponse.json({ source }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id, active, tags } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const data: any = {};
  if (typeof active === "boolean") data.active = active;
  if (Array.isArray(tags)) {
    data.tags = tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
  }

  const source = await prisma.source.update({ where: { id }, data });
  return NextResponse.json({ source });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { id } = await req.json();
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.source.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
