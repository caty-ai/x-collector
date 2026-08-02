import { createMcpHandler } from "mcp-handler";
import { NextResponse } from "next/server";

import { PRODUCT_SLUG } from "@/lib/branding";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";
import { registerMcpTools } from "@/lib/mcp/tools";

const handler = createMcpHandler(
  (server) => registerMcpTools(server),
  { serverInfo: { name: PRODUCT_SLUG, version: "1.0.0" } },
  { basePath: "/api/mcp" },
);
let warnedMissingMcpApiKey = false;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

async function authenticatedHandler(request: Request): Promise<Response> {
  const apiKey = process.env.MCP_API_KEY?.trim() || process.env.FAMILY_FEED_API_KEY?.trim();
  let denied: Response | null = null;
  if (!apiKey) {
    if (isProductionRuntime()) {
      denied = NextResponse.json({ error: "api key not configured" }, { status: 401 });
    } else {
      if (!warnedMissingMcpApiKey) {
        warnedMissingMcpApiKey = true;
        console.warn(
          "[mcp-api] API auth disabled outside production; missing env: MCP_API_KEY | FAMILY_FEED_API_KEY",
        );
      }
    }
  } else {
    const auth = request.headers.get("authorization");
    const match = /^Bearer\s+(.+)$/i.exec(auth || "");
    if (!match || !timingSafeBearerCheck(auth, apiKey)) {
      denied = NextResponse.json(
        { error: "Unauthorized. Provide a Bearer token." },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      );
    }
  }
  if (denied) {
    return denied;
  }

  return handler(request);
}

export { authenticatedHandler as GET, authenticatedHandler as POST, authenticatedHandler as DELETE };
