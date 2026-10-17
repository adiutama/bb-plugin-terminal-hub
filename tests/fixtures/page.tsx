// Mounts the Terminals page in bb's slot test harness and follows its
// navigation, so a test sees the page the way the router would show it.
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, type RenderedSlot, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { fakeSdk, type World } from "./fake-bb";

const followers: ReturnType<typeof setInterval>[] = [];

/** Stops following navigation for every mounted page. */
export function stopFollowing(): void {
  for (const timer of followers.splice(0)) clearInterval(timer);
}

export async function loadApp() {
  return loadPluginApp(() => import("../../app"));
}

export interface MountedPage {
  slot: RenderedSlot;
  sdk: ReturnType<typeof fakeSdk>["sdk"];
  emitThreadChanged: ReturnType<typeof fakeSdk>["emitThreadChanged"];
  world: World;
  /** The subPath the page is showing now. */
  subPath(): string;
  /** toPluginPanel calls, in order. */
  navigations(): { subPath: string; replace: boolean }[];
  /** Shows another URL, as Back or a pasted link would. */
  goTo(subPath: string): void;
  /** Leaves the page, as opening a thread does. */
  leave(): void;
  /** Comes back to the page at `subPath` (the rail opens it at its root, ""). */
  returnTo(subPath: string): void;
}

export async function mountPage(
  w: World,
  subPath: string,
  context: { projectId?: string | null; threadId?: string | null } = { projectId: "proj_1" },
  /** Runs on the fake SDK before the page mounts, to hold or fail calls. */
  prepare?: (sdk: ReturnType<typeof fakeSdk>["sdk"]) => void,
  /** The server's RPC methods; without them, Services calls fail. */
  rpc?: Record<string, (input: unknown) => unknown>,
): Promise<MountedPage> {
  const app = await loadApp();
  const panel = app.navPanels[0];
  if (!panel) throw new Error("no navPanel");
  const Page = panel.component as ComponentType<PluginNavPanelProps>;
  // bb's title bar holds the panel's headerContent, mounted apart from the page.
  const Header = panel.headerContent as ComponentType<PluginNavPanelProps>;
  const Shell = ({ subPath, open = true }: { subPath: string; open?: boolean }) =>
    open ? (
      <>
        <div data-testid="title-bar">
          <Header subPath={subPath} />
        </div>
        <Page subPath={subPath} />
      </>
    ) : (
      <div data-testid="elsewhere" />
    );
  const bb = fakeSdk(w);
  prepare?.(bb.sdk);
  let current = subPath;
  let open = true;
  let followed = 0;
  const slot = renderSlot(
    { component: Shell },
    { subPath },
    { sdk: bb.sdk as any, rpc: rpc as any, context: { threadId: null, ...context } },
  );
  const navigations = () =>
    slot.inspection.navigateCalls.flatMap((call) =>
      call.method === "toPluginPanel"
        ? [{ subPath: call.options?.subPath ?? "", replace: call.options?.replace ?? false }]
        : [],
    );
  // Follow navigations like bb's router: re-render with the new subPath.
  const follow = () => {
    const all = navigations();
    if (all.length === followed) return;
    followed = all.length;
    const last = all.at(-1);
    if (open && last && last.subPath !== current) {
      current = last.subPath;
      slot.lifecycle.rerender(<Shell subPath={current} />);
    }
  };
  followers.push(setInterval(() => act(follow), 5));
  return {
    slot,
    sdk: bb.sdk,
    emitThreadChanged: bb.emitThreadChanged,
    world: w,
    subPath: () => current,
    navigations,
    goTo: (subPath) => {
      current = subPath;
      act(() => slot.lifecycle.rerender(<Shell subPath={subPath} />));
    },
    leave: () => {
      open = false;
      act(() => slot.lifecycle.rerender(<Shell subPath={current} open={false} />));
    },
    returnTo: (subPath) => {
      open = true;
      followed = navigations().length;
      current = subPath;
      act(() => slot.lifecycle.rerender(<Shell subPath={subPath} />));
    },
  };
}

/** Opens a menu from its trigger with the keyboard, as Radix expects in jsdom. */
export async function openMenu(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}
