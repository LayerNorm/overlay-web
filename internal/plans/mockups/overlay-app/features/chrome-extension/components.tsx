"use client";

import { useState } from "react";
import { Button } from "@overlay/ui/primitives";
import { SettingsGroup, SettingsToggle } from "@overlay/modules-react/settings";
import { DesktopRow, DesktopSection } from "@/features/settings/components/DesktopSettingsParts";

/** Proposed Settings → Browser, shown only when the app runs inside the Chrome extension's side panel. */
export function ChromeBrowserSettings() {
  const [enabled, setEnabled] = useState(true);
  const [sites, setSites] = useState([
    { host: "northwind-supply.example", access: "Always allowed" },
    { host: "docs.example.org", access: "Always allowed" },
    { host: "bank.example", access: "Blocked" },
  ]);
  return (
    <div className="flex flex-col gap-6">
      <DesktopSection
        title="This browser"
        description="Agents you start on any device can use this Chrome, with your sign-ins. They work in their own tabs, ask before each new site, and never type passwords or payment details. Only you can use it."
      >
        <SettingsGroup>
          <DesktopRow
            title="Let agents use this browser"
            description={enabled ? "Chrome on macOS · Connected" : "Off"}
            control={
              <SettingsToggle
                checked={enabled}
                onChange={() => setEnabled((value) => !value)}
                aria-label="Let agents use this browser"
              />
            }
          />
        </SettingsGroup>
      </DesktopSection>
      {enabled ? (
        <DesktopSection title="Sites" description="Sites you allowed or blocked when an agent asked.">
          <SettingsGroup>
            {sites.map((site) => (
              <DesktopRow
                key={site.host}
                title={site.host}
                description={site.access}
                control={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSites((list) => list.filter((entry) => entry.host !== site.host))}
                  >
                    Remove
                  </Button>
                }
              />
            ))}
          </SettingsGroup>
        </DesktopSection>
      ) : null}
    </div>
  );
}
