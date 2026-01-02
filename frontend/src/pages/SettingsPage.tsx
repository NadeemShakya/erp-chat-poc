import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DevToolsPanel } from "@/components/dev/DevToolsPanel";

export default function SettingsPage() {
  const showDev =
    String(import.meta.env.VITE_SHOW_DEV_TOOLS ?? "true").toLowerCase() ===
    "true";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          General settings + developer utilities.
        </p>
      </div>

      {showDev ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">Dev Tools</div>
          <DevToolsPanel />
        </div>
      ) : null}
    </div>
  );
}
