// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Panel from "@/app/app/components/EditVideoSwapCharactersPanel";
beforeEach(() => {
  vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:owner-local-fixture");
  vi.spyOn(URL,"revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { cleanup();vi.restoreAllMocks();vi.unstubAllGlobals(); });
describe("Swap Characters H3 GPU control", () => {
  it("only shows the GPU selector for H3 and retains the explicit choice", () => {
    render(<Panel />);
    expect(screen.queryByRole("combobox",{name:"MiniMax H3 GPU"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/MiniMax H3/}));
    fireEvent.change(screen.getByRole("combobox",{name:"MiniMax H3 GPU"}),{target:{value:"rtx5060ti"}});
    expect(screen.getByRole("combobox",{name:"MiniMax H3 GPU"})).toHaveValue("rtx5060ti");
    fireEvent.click(screen.getByRole("button",{name:/SCAIL-2/}));
    expect(screen.queryByRole("combobox",{name:"MiniMax H3 GPU"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/MiniMax H3/}));
    expect(screen.getByRole("combobox",{name:"MiniMax H3 GPU"})).toHaveValue("rtx5060ti");
  });
  it.each(["rtx3090","rtx5060ti"])("sends %s and both owner media files in the actual submit payload", async target => {
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,result:{status:"completed",engine:"minimax-h3",backend:target}})});
    vi.stubGlobal("fetch",fetcher);
    render(<Panel />);
    fireEvent.click(screen.getByRole("button",{name:/MiniMax H3/}));
    fireEvent.change(screen.getByRole("combobox",{name:"MiniMax H3 GPU"}),{target:{value:target}});
    fireEvent.change(screen.getByLabelText("Upload Video"),{target:{files:[new File(["fixture-video"],"owner.mp4",{type:"video/mp4"})]}});
    fireEvent.change(screen.getByLabelText("Upload Replacement Picture"),{target:{files:[new File(["fixture-image"],"person.png",{type:"image/png"})]}});
    fireEvent.click(screen.getByRole("button",{name:"Submit 5-Second Clip"}));
    await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    const [url,request]=fetcher.mock.calls[0];
    expect(url).toBe("/api/edit-video/swap-characters/submit");expect(request.method).toBe("POST");
    expect(request.body.get("targetBackend")).toBe(target);expect(request.body.get("engine")).toBe("minimax-h3");
    expect(request.body.get("video_file").name).toBe("owner.mp4");expect(request.body.get("replacement_0_file").name).toBe("person.png");
    expect(request.body.get("preserve_audio")).toBe("true");expect(request.body.get("clip_duration_seconds")).toBe("5");
    await waitFor(()=>expect(screen.getByRole("button",{name:"Submit 5-Second Clip"})).not.toBeDisabled());
  });
});
