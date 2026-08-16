const fs = require("fs");
const path = require("path");

function matchesRoute(route, requestUrl, method) {
  if ((route.method || "GET").toUpperCase() !== method) return false;
  if (route.path !== requestUrl.pathname) return false;

  const expectedQuery = route.query || {};
  return Object.entries(expectedQuery).every(([key, value]) => requestUrl.searchParams.get(key) === value);
}

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function parseJsonBody(body) {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function appendRequestLog(logPath, entry) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

async function main() {
  const casePath = process.argv[2] || process.env.GATE_CASE_PATH;
  const gatePath = process.argv[3] || process.env.GATE_SCRIPT_PATH;

  if (!casePath) throw new Error("gate case path is required");
  if (!gatePath) throw new Error("gate script path is required");

  const parsedCase = JSON.parse(fs.readFileSync(casePath, "utf8"));
  const routes = Array.isArray(parsedCase.routes) ? parsedCase.routes : [];
  const requestLogPath = process.env.GATE_REQUEST_LOG;

  global.fetch = async (input, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const requestUrl = new URL(typeof input === "string" ? input : input.url);
    const route = routes.find((candidate) => matchesRoute(candidate, requestUrl, method));
    appendRequestLog(requestLogPath, {
      method,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      body: parseJsonBody(init.body),
      matched: Boolean(route),
    });

    if (!route) {
      return makeJsonResponse(500, {
        error: `unmocked route: ${method} ${requestUrl.pathname}${requestUrl.search}`,
      });
    }

    return makeJsonResponse(route.status || 200, route.body);
  };

  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "commonjs" },
  });

  require(path.resolve(gatePath));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
