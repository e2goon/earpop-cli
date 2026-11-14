import { render } from "ink";

import { installInterruptListeners } from "#/app/interrupt.js";
import { LiveApp } from "#/app/live-app.js";
import { registerApp } from "#/app/runtime.js";
import { SettingsApp } from "#/app/settings-app.js";
import type { SttLanguage } from "#/lib/languages.js";

export function runTui({
  screen,
  languages,
  translation,
}: {
  screen: "live" | "settings";
  languages?: SttLanguage[];
  translation?: SttLanguage[];
}) {
  installInterruptListeners();
  registerApp(
    render(
      screen === "live" ? (
        <LiveApp languages={languages} translation={translation} />
      ) : (
        <SettingsApp />
      ),
      {
        exitOnCtrlC: false,
        incrementalRendering: true,
      },
    ),
  );
}
