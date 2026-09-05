import { afterEach, describe, expect, it, vi } from "vitest";
import { publishItem, publishPrismaStub } from "../../lib/pipeline/__tests__/helpers/fixtures";

// Importing the manual CLI runs main(); keep Prisma and process boundaries isolated.
describe("manual publish re-runs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.doUnmock("@prisma/client");
    vi.resetModules();
  });

  it.each([
    { flags: [], refused: true, dryRun: false, date: "2026-03-12", writes: 0 },
    { flags: ["--allow-append"], refused: false, dryRun: false, date: "2026-03-12", writes: 1 },
    { flags: ["--dry-run", "--allow-append", "--date=2026-03-11"], refused: false, dryRun: true, date: "2026-03-11", writes: 0 },
  ])("handles $flags (refused=$refused)", async ({ flags, refused, dryRun, date, writes }) => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-12T03:00:00.000Z"));
    const stub = publishPrismaStub({
      mainRows: [publishItem("manual-unbound")],
      edition: { id: "published-edition", slug: "existing-slug", title: "Existing title", status: "published" },
      maxPosition: 120,
    });
    const disconnect = vi.fn(async () => undefined);
    vi.doMock("@prisma/client", () => ({
      PrismaClient: vi.fn(() => ({ ...stub.prisma, $disconnect: disconnect })),
    }));
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "pipeline-publish.ts", ...flags]);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../pipeline-publish");
    await vi.waitFor(() => {
      expect(error, error.mock.calls.map((args) => args.join(" ")).join("\n")).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledTimes(1);
    }, { timeout: 5_000 });

    expect(exit).not.toHaveBeenCalled();
    expect(error, error.mock.calls.map((args) => args.join(" ")).join("\n")).not.toHaveBeenCalled();
    const summary = JSON.parse(log.mock.calls.find(([message]) => String(message).startsWith("{"))![0]);
    expect(summary).toMatchObject({
      dryRun,
      editionDate: date,
      refusedReason: refused ? "edition_already_published" : null,
      counter: { selected: refused ? 0 : 1, bindingsCreated: refused ? 0 : 1 },
    });
    expect(stub.bindingWrites).toHaveLength(writes);
    expect(stub.calls).toEqual({
      findMany: refused ? 0 : 2,
      updateMany: writes,
      pipelineRunCreate: writes,
      transaction: writes,
    });
    if (!refused) {
      expect(summary.previews[0]).toMatchObject({ pipelineItemId: "manual-unbound", position: 121 });
    }
    if (writes) {
      expect(stub.bindingWrites[0].create).toMatchObject({ pipelineItemId: "manual-unbound", position: 121 });
    }
  });
});
