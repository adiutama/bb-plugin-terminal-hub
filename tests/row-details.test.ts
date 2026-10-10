import { describe, expect, it } from "vitest";
import { shortenHome } from "../lib/paths";
import { findServerHint, OutputTail } from "../lib/server-hint";

describe("row details", () => {
  it("LIST-6: shows the starting directory with the host's home directory as ~", () => {
    expect(shortenHome("/Users/me/repo", "/Users/me")).toBe("~/repo");
    expect(shortenHome("/Users/me", "/Users/me/")).toBe("~");
    expect(shortenHome("/Users/meadow/repo", "/Users/me")).toBe("/Users/meadow/repo");
    expect(shortenHome("/srv/app", "/home/me")).toBe("/srv/app");
    expect(shortenHome("/Users/me/repo", null)).toBe("/Users/me/repo");
  });

  it("LIST-7: finds a local server address in recent output", () => {
    expect(findServerHint("Listening on http://localhost:3000/")).toEqual({
      url: "http://localhost:3000/",
      label: ":3000",
    });
    expect(findServerHint("ready at http://127.0.0.1:8080.")?.label).toBe(":8080");
    expect(
      findServerHint(
        "\x1b[32m  ➜  \x1b[1mLocal\x1b[22m:\x1b[39m   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m",
      ),
    ).toEqual({ url: "http://localhost:5173/", label: ":5173" });
    expect(findServerHint("  - Local:        http://my-box.local:4000")).toEqual({
      url: "http://my-box.local:4000",
      label: ":4000",
    });
    expect(
      findServerHint("restarted\nhttp://localhost:3000\nnow http://localhost:3001")?.label,
    ).toBe(":3001");
    expect(findServerHint("see https://example.com:443/docs")).toBeNull();
    expect(findServerHint("no servers here")).toBeNull();
  });

  it("LIST-7: reads the hint from the last 4 KB only", () => {
    const tail = new OutputTail();
    tail.push(new TextEncoder().encode("http://localhost:1111\n"));
    tail.push(new TextEncoder().encode("x".repeat(5000)));
    expect(findServerHint(tail.text())).toBeNull();
    tail.push(new TextEncoder().encode("http://localhost:2222\n"));
    expect(findServerHint(tail.text())?.label).toBe(":2222");
  });
});
