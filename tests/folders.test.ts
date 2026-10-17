import { describe, expect, it, vi } from "vitest";
import { FolderChecks, isMissingFolder, menuEnvironments } from "../lib/folders";

const env = (id: string) => ({ id, name: id, path: `/w/${id}`, hostId: "host_1" });

describe("folder checks", () => {
  it("LIST-48: only ENOENT means a missing folder; any other failure keeps the environment", () => {
    expect(isMissingFolder({ status: 502, code: "ENOENT", message: "HTTP 502: ENOENT: …" })).toBe(
      true,
    );
    expect(isMissingFolder(new Error("HTTP 502: ENOENT: no such file or directory"))).toBe(true);
    expect(isMissingFolder({ status: 502, code: "EACCES", message: "permission denied" })).toBe(
      false,
    );
    expect(
      isMissingFolder({ status: 404, code: "host_not_found", message: "Host not found" }),
    ).toBe(false);
    expect(isMissingFolder(null)).toBe(false);
  });

  it("LIST-48: environments with terminals are listed unchecked; others once their folder exists or the check failed otherwise", () => {
    const states = new Map([
      ["exists", "exists" as const],
      ["missing", "missing" as const],
      ["kept", "kept" as const],
      ["checking", "checking" as const],
    ]);
    const result = menuEnvironments(
      ["busy", "exists", "missing", "kept", "checking", "new"].map(env),
      (id) => id === "busy",
      states,
    );
    expect(result.shown.map((e) => e.id)).toEqual(["busy", "exists", "kept"]);
    expect(result.unchecked.map((e) => e.id)).toEqual(["new"]);
    expect(result.checking).toBe(true);
    expect(menuEnvironments([env("busy")], () => true, new Map()).checking).toBe(false);
  });

  it("LIST-48: asks the host with hosts.directory once per environment, and keeps the answer until bb reloads", async () => {
    const directory = vi.fn(async ({ path }: { hostId: string; path?: string }) => {
      if (path === "/w/gone") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { directory: path ?? "" };
    });
    const checks = new FolderChecks({ hosts: { directory } });
    const seen: number[] = [];
    checks.subscribe(() => seen.push(checks.get().size));
    checks.check([env("here"), env("gone")]);
    expect(checks.get().get("here")).toBe("checking");
    await Promise.resolve();
    await Promise.resolve();
    expect(checks.get().get("here")).toBe("exists");
    expect(checks.get().get("gone")).toBe("missing");
    checks.check([env("here"), env("gone")]);
    expect(directory).toHaveBeenCalledTimes(2);
    expect(directory).toHaveBeenCalledWith({ hostId: "host_1", path: "/w/here" });
  });
});
