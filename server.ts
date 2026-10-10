// Terminal Hub backend entry.
//
// Small on purpose: the page talks to bb's terminals API directly through
// `useSdk()`. The server only serves the Ghostty WebAssembly engine to the
// page and hosts the `bb terminal-hub` CLI command for agents.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { type BbPluginApi, cliCommand, defineCli, PluginCliError } from "@get-bb/plugin-sdk";
import { formatText, listEnvironment, resolveEnvironment, toJson } from "./lib/cli";

export default async function plugin(bb: BbPluginApi) {
  // Resolve the WASM from the pinned engine package in both source and dist
  // installs, so there is no second checked-in binary to drift out of sync.
  const wasmPath = createRequire(import.meta.url).resolve("@wterm/ghostty/ghostty-vt.wasm");
  bb.http.route(
    "GET",
    "/ghostty-vt.wasm",
    async () =>
      new Response(new Uint8Array(await readFile(wasmPath)), {
        headers: {
          "content-type": "application/wasm",
          "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      }),
  );

  bb.cli.register(
    defineCli({
      name: "terminal-hub",
      summary: "List the terminals running in an environment, as the Terminals page shows them",
      commands: {
        list: cliCommand({
          summary: "List an environment's terminals, grouped by owner, with server hints",
          description:
            "Shows the environment's own terminals, then every thread terminal in it (archived threads included) with its thread and state. Run it before starting a dev server or watcher, and reuse a matching terminal instead of starting another.",
          options: {
            environment: {
              type: "string",
              description: "Environment id (env_…). Defaults to the calling thread's environment.",
              aliases: ["env", "environment-id"],
              placeholder: "id",
            },
            json: { type: "boolean", description: "Print machine-readable JSON" },
          },
          async run(input, ctx) {
            const environmentId = await resolveEnvironment(
              bb.sdk,
              input.options.environment,
              ctx.threadId,
            );
            if (!environmentId) {
              throw new PluginCliError("no environment to list", {
                code: "environment_required",
                hint: "Pass --environment <id>; `bb environment list` shows the ids.",
              });
            }
            const listing = await listEnvironment(bb.sdk, environmentId);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? `${JSON.stringify(toJson(listing), null, 2)}\n`
                : formatText(listing, Date.now()),
            };
          },
        }),
      },
    }),
  );
}
