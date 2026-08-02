const OPS_ALERT_TIMEOUT_MS = 10_000;

type Logger = Pick<Console, "error">;

async function readResponseTextSafely(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000);
  } catch (error) {
    return `unable to read response body: ${String(error).slice(0, 500)}`;
  }
}

export async function sendOpsAlert(
  text: string,
  logger: Logger = console,
): Promise<boolean> {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return false;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(OPS_ALERT_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error(
        `[ops-alert] webhook failed: ${response.status} ${await readResponseTextSafely(response)}`,
      );
    }
  } catch (error) {
    logger.error("[ops-alert] webhook request failed", error);
  }

  return true;
}

export async function sendHeartbeat(
  url: string | undefined,
  label: string,
  logger: Logger = console,
): Promise<boolean> {
  if (!url) return false;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(OPS_ALERT_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error(
        `[ops-alert] heartbeat ${label} failed: ${response.status} ${await readResponseTextSafely(response)}`,
      );
    }
  } catch (error) {
    logger.error(`[ops-alert] heartbeat ${label} request failed`, error);
  }

  return true;
}
