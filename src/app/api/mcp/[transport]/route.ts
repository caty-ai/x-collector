import { createMcpHandler } from "mcp-handler";

import { PRODUCT_SLUG } from "@/lib/branding";
import { denyUnlessBearer, type BearerGateSpec } from "@/lib/auth/bearer-gate";
import { registerMcpTools } from "@/lib/mcp/tools";

const handler = createMcpHandler(
  (server) => registerMcpTools(server),
  { serverInfo: { name: PRODUCT_SLUG, version: "1.0.0" } },
  { basePath: "/api/mcp" },
);
const MCP_BEARER_GATE: BearerGateSpec = {
  logTag: "mcp-api",
  resolveConfiguredBearer: () =>
    process.env.MCP_API_KEY?.trim() || process.env.FAMILY_FEED_API_KEY?.trim() || undefined,
  missingEnvHint: "MCP_API_KEY | FAMILY_FEED_API_KEY",
  unauthorizedBody: { error: "Unauthorized. Provide a Bearer token." },
  unauthorizedHeaders: { "WWW-Authenticate": "Bearer" },
  requireBearerScheme: true,
};

async function authenticatedHandler(request: Request): Promise<Response> {
  const denied = denyUnlessBearer(request, MCP_BEARER_GATE);
  if (denied) {
    return denied;
  }

  return handler(request);
}

export { authenticatedHandler as GET, authenticatedHandler as POST, authenticatedHandler as DELETE };
