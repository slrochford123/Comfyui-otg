import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildInternalSourceProxyFetch,
} from "../../../app/api/background-angle-plate/internalSourceProxy";

describe("Background Angle Plate internal source proxy origin", () => {
  it("uses the validated request origin instead of forcing loopback", () => {
    const result =
      buildInternalSourceProxyFetch({
        requestOrigin:
          "http://100.75.162.64:3001",
        sourceValue:
          "/api/comfy/history-image?promptId=test-prompt&nodeId=73&image=1",
        requestHeaders:
          new Headers({
            cookie:
              "otg_session=test",
            "x-otg-device-id":
              "test-device",
          }),
      });

    expect(
      result.fetchUrl.origin,
    ).toBe(
      "http://100.75.162.64:3001",
    );

    expect(
      result.fetchUrl.pathname,
    ).toBe(
      "/api/comfy/history-image",
    );

    expect(
      result.fetchUrl.searchParams.get(
        "promptId",
      ),
    ).toBe(
      "test-prompt",
    );

    expect(
      result.fetchUrl.hostname,
    ).not.toBe(
      "127.0.0.1",
    );

    expect(
      result.headers.get(
        "cookie",
      ),
    ).toBe(
      "otg_session=test",
    );

    expect(
      result.headers.get(
        "x-otg-device-id",
      ),
    ).toBe(
      "test-device",
    );
  });

  it("still rejects cross-origin image references", () => {
    expect(() =>
      buildInternalSourceProxyFetch({
        requestOrigin:
          "http://100.75.162.64:3001",
        sourceValue:
          "http://example.com/api/comfy/history-image?promptId=test",
        requestHeaders:
          new Headers(),
      }),
    ).toThrow(
      "Selected preview is not a supported OTG image reference.",
    );
  });

  it("still rejects unsupported same-origin paths", () => {
    expect(() =>
      buildInternalSourceProxyFetch({
        requestOrigin:
          "http://100.75.162.64:3001",
        sourceValue:
          "/api/auth/me",
        requestHeaders:
          new Headers(),
      }),
    ).toThrow(
      "Selected preview is not a supported OTG image reference.",
    );
  });
});
