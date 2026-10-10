#!/usr/bin/env node
// Live smoke test against the running bb, with this plugin installed.
//
//   npm run test:live -- --environment env_…   (defaults to $BB_ENVIRONMENT_ID)
//
// Starts an environment-scoped terminal, checks that `bb terminal-hub list`
// shows it with its server hint, checks the page can fetch the Ghostty WASM,
// and closes the terminal again.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = args.indexOf("--environment");
const environmentId = flag === -1 ? process.env.BB_ENVIRONMENT_ID : args[flag + 1];
if (!environmentId) {
  console.error("Pass --environment <id> or run inside a bb thread.");
  process.exit(1);
}

/** @param {string[]} argv */
function bb(argv) {
  return execFileSync(process.env.BB_CLI ?? "bb", argv, { encoding: "utf8" });
}

/** @param {boolean} ok @param {string} label */
function check(ok, label) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const title = `terminal-hub smoke ${Date.now()}`;
const created = JSON.parse(
  bb([
    "terminal",
    "create",
    "--environment",
    environmentId,
    "--title",
    title,
    "--json",
    "--command",
    "echo 'Local: http://localhost:4319/'; sleep 120",
  ]),
);
const id = created.id ?? created.session?.id;
try {
  check(typeof id === "string", `created ${id}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const listing = JSON.parse(
    bb(["terminal-hub", "list", "--environment", environmentId, "--json"]),
  );
  const row = listing.terminals.find((/** @type {{ id: string }} */ t) => t.id === id);
  check(row !== undefined, "bb terminal-hub list shows it");
  check(row?.scope === "environment", "listed at environment scope");
  check(row?.serverHint === "http://localhost:4319/", `server hint ${row?.serverHint}`);

  const text = bb(["terminal-hub", "list", "--environment", environmentId]);
  check(text.includes(title), "text output names it");

  const server = process.env.BB_SERVER_URL;
  if (server) {
    const response = await fetch(`${server}/api/v1/plugins/terminal-hub/http/ghostty-vt.wasm`);
    check(
      response.ok && response.headers.get("content-type") === "application/wasm",
      `Ghostty WASM served (${response.status})`,
    );
  } else {
    console.log("skip Ghostty WASM check: BB_SERVER_URL is not set");
  }
} finally {
  if (typeof id === "string") bb(["terminal", "close", id]);
}
