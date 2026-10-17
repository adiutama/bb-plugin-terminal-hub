// Terminal Hub backend entry.
//
// The Terminals page talks to bb's terminals API directly through `useSdk()`.
// The server serves the Ghostty WebAssembly engine to the page, scans and
// signals processes for the Services page over plugin RPC (ADR 202610171646),
// and hosts the `bb terminal-hub` CLI command for agents.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { type BbPluginApi, cliCommand, defineCli, PluginCliError } from "@get-bb/plugin-sdk";
import { formatText, listEnvironment, resolveEnvironment, toJson } from "./lib/cli";
import { nodeProcessHost } from "./lib/process-host";
import type { ProcessHost } from "./lib/processes";
import { Services } from "./lib/services";
import { formatServicesText, servicesIn, servicesJson } from "./lib/services-cli";
import { servicesContract } from "./lib/services-contract";

const environmentOption = {
  type: "string",
  description: "Environment id (env_…). Defaults to the calling thread's environment.",
  aliases: ["env", "environment-id"],
  placeholder: "id",
} as const;

export default function plugin(bb: BbPluginApi) {
  return createPlugin(bb, nodeProcessHost());
}

/** The plugin over `host`: the real machine, or recorded output in tests. */
export async function createPlugin(bb: BbPluginApi, host: ProcessHost) {
  const services = new Services(bb.sdk, host);
  bb.rpc.register(servicesContract, {
    "services.list": () => services.list(),
    "services.plan": ({ pid, startedAt }) => services.plan(pid, startedAt),
    "services.stop": ({ pid, startedAt, force, expected }) =>
      services.stop(pid, startedAt, force, expected),
    "services.log": ({ pid, startedAt }) => services.log(pid, startedAt),
  });

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
      summary:
        "List the terminals and servers running in an environment, as the Terminals and Services pages show them",
      commands: {
        list: cliCommand({
          summary: "List an environment's terminals, grouped by owner, with server hints",
          description:
            "Shows the environment's own terminals, then every thread terminal in it (archived threads included) with its thread and state. Run it before starting a dev server or watcher, and reuse a matching terminal instead of starting another.",
          options: {
            environment: environmentOption,
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
        services: cliCommand({
          summary: "List the servers running in an environment outside bb terminals",
          description:
            "Shows the processes the Services page lists for the environment: each listening process with its ports, PID, command line, starting thread, and log file. Run it with `list` before starting a server, and reuse a listed one instead of starting another.",
          options: {
            environment: environmentOption,
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
            const listing = servicesIn(await services.list(), environmentId);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? `${JSON.stringify(servicesJson(listing), null, 2)}\n`
                : formatServicesText(listing, Date.now()),
            };
          },
        }),
      },
    }),
  );
}
