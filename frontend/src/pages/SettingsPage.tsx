import { DevToolsPanel } from "@/components/dev/DevToolsPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const showDev =
    String(import.meta.env.VITE_SHOW_DEV_TOOLS ?? "true").toLowerCase() ===
    "true";

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="flex flex-col gap-4">
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">Settings</CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">
                  General settings and developer utilities for the ERP Chat POC.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">ERP Chat POC</Badge>
                <Badge variant="outline">
                  LangChain • RAG • PDO • LangSmith
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <Separator className="mb-4" />
            <div className="text-sm text-muted-foreground">
              This page is intended for configuration and diagnostics. Dev tools
              can be hidden by setting{" "}
              <span className="font-mono">VITE_SHOW_DEV_TOOLS=false</span>.
            </div>
          </CardContent>
        </Card>

        {showDev ? <DevToolsPanel /> : null}
      </div>
    </div>
  );
}
