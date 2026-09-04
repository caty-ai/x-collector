import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { composeNewsletterEditionScript } from "../lib/pipeline/compose-edition-script";
import { assertRequiredEnv, toPipelineDateUtc } from "./prod-schedule-utils";
import { parseArgs } from "./recompose-args";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertRequiredEnv(["DATABASE_URL"]);

  const prisma = new PrismaClient();
  try {
    const result = await composeNewsletterEditionScript(prisma, {
      editionDate: toPipelineDateUtc(options.dateKeyJst),
      dryRun: options.dryRun,
      captureContent: true,
      logger: console,
    });
    const { contentMd = "", ...metrics } = result;
    console.log(JSON.stringify(metrics, null, 2));

    if (options.outFile) {
      await writeFile(options.outFile, contentMd, "utf8");
    } else if (options.dryRun) {
      console.log(contentMd);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    const failsafe = setTimeout(() => process.exit(0), 5000);
    process.stdout.write("", () => {
      clearTimeout(failsafe);
      process.exit(0);
    });
  })
  .catch((error) => {
    console.error("Fatal script recompose error:", error);
    process.exit(1);
  });
