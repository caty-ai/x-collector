/** Display name — user-facing UI, summaries, page metadata. */
export const PRODUCT_NAME = process.env.PRODUCT_NAME ?? "X Collector";
/** Machine slug — MCP server name and User-Agent product token. */
export const PRODUCT_SLUG = process.env.PRODUCT_SLUG ?? "x-collector";
/** Contact URL embedded in outbound User-Agent strings. */
export const UA_CONTACT = process.env.UA_CONTACT ?? "+https://github.com/caty-ai/x-collector";

type UserAgentOptions = {
  contact?: string;
  compatible?: boolean;
};

export function userAgent(
  component?: string,
  options: UserAgentOptions = {},
): string {
  const productToken = `${PRODUCT_SLUG}${component ? `-${component}` : ""}/1.0`;
  const contact = options.contact ?? (options.compatible ? UA_CONTACT : undefined);

  if (options.compatible) {
    return `Mozilla/5.0 (compatible; ${productToken}; ${contact})`;
  }

  return contact ? `${productToken} (${contact})` : productToken;
}
