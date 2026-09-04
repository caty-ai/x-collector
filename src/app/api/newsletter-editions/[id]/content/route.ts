import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";
import { editionMarkdownHeaders } from "@/lib/pipeline/edition-markdown-response";

const prisma = new PrismaClient();
let warnedMissingNewsletterApiKey = false;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const apiKey =
    process.env.NEWSLETTER_API_KEY?.trim() ||
    process.env.DIGEST_API_KEY?.trim() ||
    process.env.FEED_API_KEY?.trim();
  let denied: Response | null = null;
  if (!apiKey) {
    if (isProductionRuntime()) {
      denied = NextResponse.json({ error: "api key not configured" }, { status: 401 });
    } else {
      if (!warnedMissingNewsletterApiKey) {
        warnedMissingNewsletterApiKey = true;
        console.warn(
          "[newsletter-content-api] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
        );
      }
    }
  } else {
    const auth = req.headers.get("authorization");
    if (!auth || !timingSafeBearerCheck(auth, apiKey)) {
      denied = NextResponse.json(
        { error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>" },
        { status: 401 },
      );
    }
  }
  if (denied) {
    return denied;
  }

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
