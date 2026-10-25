import { render } from "ink";

import { installInterruptListeners } from "#/app/interrupt.js";
import { LiveApp } from "#/app/live-app.js";
import { registerApp } from "#/app/runtime.js";
import { SettingsApp } from "#/app/settings-app.js";

export function runTui(screen: "live" | "settings") {
  installInterruptListeners();
  registerApp(render(screen === "live" ? <LiveApp /> : <SettingsApp />, { exitOnCtrlC: false }));
}
