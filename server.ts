// Terminal Hub backend entry.
//
// Small on purpose: the page talks to bb's terminals API directly through
// `useSdk()`. The server only serves the Ghostty WebAssembly engine to the
// page and hosts the `bb terminal-hub` CLI command for agents.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

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
}
