import { getDateKeyInJst, validateDateKeyJst } from "./prod-schedule-utils";

export interface RecomposeCliOptions {
  dateKeyJst: string;
  dryRun: boolean;
  outFile?: string;
}

function requireOutFile(value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error("Missing value for --out");
  }
  return value;
}

export function parseArgs(argv: string[]): RecomposeCliOptions {
  const options: RecomposeCliOptions = {
    dateKeyJst: getDateKeyInJst(),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token.startsWith("--date-jst=")) {
      options.dateKeyJst = validateDateKeyJst(token.slice("--date-jst=".length));
      continue;
    }
    if (token === "--date-jst") {
      options.dateKeyJst = validateDateKeyJst(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      options.outFile = requireOutFile(token.slice("--out=".length));
      continue;
    }
    if (token === "--out") {
      options.outFile = requireOutFile(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}
