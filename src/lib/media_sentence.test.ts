// The voice/camera unavailable sentence (round 2, item 11; identical copy in every app). Over plain
// http it is the kit's insecureContextReason() sentence, the only https sentence; in a secure context
// without getUserMedia the browser lacks the API and the sentence says so (no https advice).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insecureContextReason } from "@abstractframework/ui-kit";

const source = readFileSync(new URL("./secure-context.ts", import.meta.url), "utf8");

async function sentenceWith(isSecureContext: boolean): Promise<string> {
  vi.resetModules();
  vi.stubGlobal("isSecureContext", isSecureContext);
  vi.stubGlobal("navigator", {});
  const mod = await import("./secure-context");
  expect(mod.mediaAvailable()).toBe(false);
  return mod.MEDIA_NEEDS_HTTPS;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("MEDIA_NEEDS_HTTPS", () => {
  it("over plain http is exactly the kit's sentence", async () => {
    const sentence = await sentenceWith(false);
    expect(sentence).toBe(insecureContextReason("voice and camera"));
    expect(sentence).toContain("loaded over http");
  });

  it("in a secure context without getUserMedia says the browser lacks it, not https", async () => {
    const sentence = await sentenceWith(true);
    expect(sentence).toBe("Voice and camera are not supported in this browser (getUserMedia unavailable).");
    expect(sentence).not.toMatch(/https/i);
  });

  it("the app keeps no https sentence of its own", () => {
    expect(source).not.toMatch(/need an https address/);
  });
});
