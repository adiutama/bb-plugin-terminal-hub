// Terminal Hub frontend entry. Compiled by `bb plugin build`; React and
// @get-bb/plugin-sdk/app are provided by bb at load time.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ServicesButton } from "./components/services-page";
import { TerminalsPage } from "./components/terminals-page";
import { PANEL_PATH } from "./lib/route";
import "@wterm/dom/css";
import "./styles.css";

export default definePluginApp((app) => {
  // NAV-1: one page with its own rail entry, at /plugins/terminal-hub/terminals.
  // SVC-1: its title bar holds the Services button; services have no page.
  app.slots.navPanel({
    id: "terminals",
    title: "Terminals",
    icon: "Terminal",
    path: PANEL_PATH,
    component: TerminalsPage,
    headerContent: ServicesButton,
  });
});
