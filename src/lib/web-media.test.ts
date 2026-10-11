import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWebMedia } from "./web-media";
import { libraryBinary } from "./library-client";
import { webWorkspace } from "../test-support/web";
vi.mock("./library-client", () => ({ libraryBinary: vi.fn() }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() { const root = document.createElement("div"); root.innerHTML = '<img data-web-media="image-one">'; const doc = webWorkspace().document; if(doc.kind!=="web")throw Error(); return {root,web:doc.web,image:root.querySelector("img")!}; }
beforeEach(() => { vi.clearAllMocks(); URL.createObjectURL = vi.fn(() => "blob:local"); URL.revokeObjectURL = vi.fn(); });
describe("local web resource hydration", () => {
  it("uses the authorized local path and waits for image decode before restoring position", async () => {
    const {root,web,image}=setup(); vi.mocked(libraryBinary).mockResolvedValue({blob:async()=>new Blob([new Uint8Array(123)],{type:"image/png"})} as Response);
    const settled=vi.fn(),clean=loadWebMedia(root,web,id=>`/entries/e/web-resources/r/${id}`,settled);
    await tick(); expect(libraryBinary).toHaveBeenCalledWith(`/entries/e/web-resources/r/${"b".repeat(64)}`,undefined,true,expect.any(AbortSignal));
    expect(image.src).toBe("blob:local"); expect(settled).not.toHaveBeenCalled();
    image.dispatchEvent(new Event("load")); await tick(); expect(settled).toHaveBeenCalledOnce();
    clean(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
  });
  it("shows resource failure honestly and never installs mismatched bytes", async () => {
    const {root,web}=setup(); vi.mocked(libraryBinary).mockResolvedValue({blob:async()=>new Blob(["bad"],{type:"image/png"})} as Response);
    const settled=vi.fn();const clean=loadWebMedia(root,web,()=>"/local",settled); await tick();
    expect(root.querySelector("img")).toBeNull(); expect(root.textContent).toContain("本机图片或图表不可用");expect(URL.createObjectURL).not.toHaveBeenCalled();expect(settled).toHaveBeenCalledOnce();clean();
  });
  it("ignores late resource reads after cancellation", async () => {
    const {root,web,image}=setup();let resolve!:(r:Response)=>void;vi.mocked(libraryBinary).mockReturnValue(new Promise(r=>resolve=r));
    const settled=vi.fn(),clean=loadWebMedia(root,web,()=>"/local",settled);clean();resolve({blob:async()=>new Blob([new Uint8Array(123)],{type:"image/png"})} as Response);await tick();
    expect(image.getAttribute("src")).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(settled).not.toHaveBeenCalled();
  });
});
