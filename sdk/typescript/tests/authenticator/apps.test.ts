import { describe, it, expect, vi } from "vitest";
import { AuthenticatorAppsResource } from "../../src/authenticator/resources/apps.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_AUTHENTICATOR_APP, RAW_AUTHENTICATOR_APP_UNLINKED } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const APP_ID = "cccc3333-0000-0000-0000-000000000001";

describe("AuthenticatorAppsResource.create", () => {
  it("creates app with agent handle", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_AUTHENTICATOR_APP);
    const res = new AuthenticatorAppsResource(http);

    const app = await res.create({ agentHandle: "sales-agent" });

    expect(http.post).toHaveBeenCalledWith("/apps", { agent_handle: "sales-agent" });
    expect(app.id).toBe(APP_ID);
    expect(app.identityId).toBe(RAW_AUTHENTICATOR_APP.identity_id);
  });

  it("creates unbound app", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_AUTHENTICATOR_APP_UNLINKED);
    const res = new AuthenticatorAppsResource(http);

    const app = await res.create();

    expect(http.post).toHaveBeenCalledWith("/apps", {});
    expect(app.identityId).toBeNull();
  });
});

describe("AuthenticatorAppsResource.list", () => {
  it("returns list of apps", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_AUTHENTICATOR_APP]);
    const res = new AuthenticatorAppsResource(http);

    const apps = await res.list();

    expect(http.get).toHaveBeenCalledWith("/apps");
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe(APP_ID);
  });

  it("returns empty list", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new AuthenticatorAppsResource(http);

    expect(await res.list()).toEqual([]);
  });
});

describe("AuthenticatorAppsResource.get", () => {
  it("returns a single app", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_AUTHENTICATOR_APP);
    const res = new AuthenticatorAppsResource(http);

    const app = await res.get(APP_ID);

    expect(http.get).toHaveBeenCalledWith(`/apps/${APP_ID}`);
    expect(app.id).toBe(APP_ID);
  });
});

describe("AuthenticatorAppsResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new AuthenticatorAppsResource(http);

    await res.delete(APP_ID);

    expect(http.delete).toHaveBeenCalledWith(`/apps/${APP_ID}`);
  });
});
