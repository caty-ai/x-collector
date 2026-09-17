import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { denyUnlessNewsletterBearer } from "@/lib/auth/newsletter-api-key";
import { editionMarkdownHeaders } from "@/lib/pipeline/edition-markdown-response";

const prisma = new PrismaClient();

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = denyUnlessNewsletterBearer(req, { logTag: "newsletter-content-api" });
  if (denied) return denied;

  const { id } = params;

  const edition = await prisma.newsletterEdition.findFirst({
    where: {
      OR: [{ id }, { slug: id }],
    },
    select: {
      id: true,
      slug: true,
      status: true,
      contentMd: true,
    },
  });

  if (!edition) {
    return NextResponse.json({ error: "Edition not found" }, { status: 404 });
  }

  if (!edition.contentMd) {
    return NextResponse.json({ error: "Edition exists but contentMd is empty" }, { status: 404 });
  }

  return new NextResponse(edition.contentMd, {
    status: 200,
    headers: editionMarkdownHeaders(edition),
  });
}
