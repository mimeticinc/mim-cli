import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatPropertiesPayload, formatPropertySetPayload, mimMain, mimUsage } from "../src/mim-cli";

// The laso.finance shape this command exists for: several properties claim the
// same site and the selected one is dead while a sibling holds the traffic.
const listPayload = {
  project_domain: "laso.finance",
  connected_google_account: "hunter@example.com",
  selected_property_id: "328670959",
  selected_property_name: "laso",
  properties: [
    { id: "328670959", name: "laso", account: "twosquared", websiteUrl: "https://laso.finance", sessions_28d: 0, selected: true },
    { id: "403226097", name: "laso.finance", account: "Laso Finance", websiteUrl: "https://laso.finance", sessions_28d: 52347, selected: false },
    { id: "999000111", name: "other site", account: "twosquared", websiteUrl: "https://other.com", sessions_28d: null, selected: false },
  ],
};

describe("mim properties formatting", () => {
  it("renders the selection, every visible property, and the sessions column", () => {
    const text = formatPropertiesPayload(listPayload);
    expect(text).toContain("Current GA4 property: 328670959 (laso)");
    expect(text).toContain("Connected Google account: hunter@example.com");
    expect(text).toContain("sessions28d");
    expect(text).toContain("52347");
    expect(text).toMatch(/\*\s+328670959/);
    expect(text).not.toMatch(/\*\s+403226097/);
    // An unreadable sessions count renders as a dash, not as 0.
    expect(text).toMatch(/999000111.*-/);
    expect(text).toContain("mim properties use <id>");
  });

  // Deliberately no "is this the wrong property" assertion. Two versions of
  // that warning were written and both were fitted to laso.finance: a zero
  // threshold, then a ratio with two invented constants. The listing shows
  // sessions per candidate with the selection marked, which is the evidence;
  // the reader draws the conclusion.
  it("shows sessions for every candidate so a wrong pick is visible", () => {
    const text = formatPropertiesPayload({
      ...listPayload,
      properties: listPayload.properties.map((row) =>
        row.id === "328670959" ? { ...row, sessions_28d: 0, selected: true }
                               : { ...row, sessions_28d: 52347 },
      ),
    });
    expect(text).toMatch(/52,?347/);
    expect(text).toContain("0");
    expect(text).toContain("Switch with `mim properties use <id>`.");
  });

  it("handles no selection and no visible properties", () => {
    const text = formatPropertiesPayload({ properties: [] });
    expect(text).toContain("No GA4 property is selected for this project yet.");
    expect(text).toContain("No GA4 properties are visible to this connection.");
  });

  it("surfaces the enrichment note when the server capped sessions lookups", () => {
    const text = formatPropertiesPayload({ ...listPayload, note: "sessions_28d was fetched for the first 20 properties only" });
    expect(text).toContain("first 20 properties only");
  });

  it("formats a successful property switch with the previous selection", () => {
    const text = formatPropertySetPayload({
      status: "ok",
      message: "GA4 property set to 403226097 (laso.finance).",
      selected: { property_id: "403226097", property_name: "laso.finance" },
      previous: { property_id: "328670959", property_name: "laso" },
    });
    expect(text).toContain("GA4 property set to 403226097");
    expect(text).toContain("Previous property: 328670959 (laso)");
  });

  it("falls back to a plain confirmation when the server sends no message", () => {
    const text = formatPropertySetPayload({ selected: { property_id: "403226097" } });
    expect(text).toContain("GA4 property set to 403226097.");
  });
});

describe("mim properties command wiring", () => {
  let configDir = "";
  let savedConfigDir: string | undefined;
  let savedToken: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "mim-properties-test-"));
    savedConfigDir = process.env.MIM_CONFIG_DIR;
    savedToken = process.env.MIM_API_TOKEN;
    process.env.MIM_CONFIG_DIR = configDir;
    delete process.env.MIM_API_TOKEN;
  });

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.MIM_CONFIG_DIR;
    else process.env.MIM_CONFIG_DIR = savedConfigDir;
    if (savedToken === undefined) delete process.env.MIM_API_TOKEN;
    else process.env.MIM_API_TOKEN = savedToken;
    rmSync(configDir, { recursive: true, force: true });
  });

  it("documents the properties commands", () => {
    const usage = mimUsage();
    expect(usage).toContain("properties                 List the GA4 properties");
    expect(usage).toContain("properties use <id>");
  });

  it("requires a property id for properties use", async () => {
    await expect(mimMain(["properties", "use"])).rejects.toThrow("usage: mim properties use <property_id>");
  });

  it("rejects extra arguments after the property id", async () => {
    await expect(mimMain(["properties", "use", "403226097", "--bogus"])).rejects.toThrow("unknown properties use option: --bogus");
  });

  it("requires authentication before listing", async () => {
    await expect(mimMain(["properties"])).rejects.toThrow("not authenticated");
  });
});
