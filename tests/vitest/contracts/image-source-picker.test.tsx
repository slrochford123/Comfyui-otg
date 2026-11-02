// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImageSourcePickerBridge from "@/app/app/components/ImageSourcePickerBridge";
import { acceptsImages, matchesOriginalAccept, PHONE_STORAGE_MIME } from "@/lib/client/imageSources";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 13) Chrome/130 Mobile");
});
afterEach(() => { cleanup(); document.querySelectorAll("input[data-picker-test]").forEach(e => e.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function input(accept: string | null = "image/*", multiple = true) {
  const field = document.createElement("input");
  field.type = "file";
  if (accept !== null) field.setAttribute("accept", accept);
  field.multiple = multiple;
  field.dataset.pickerTest = "true";
  document.body.append(field);
  return field;
}

function open(field: HTMLInputElement) { act(() => field.click()); }

it("covers image MIME filters, extensions, generic and mixed inputs without hijacking other file types", () => {
  for (const accept of ["image/*", ".JPG,.heic", "image/png,video/*", "", "*/*"]) expect(acceptsImages(accept)).toBe(true);
  for (const accept of ["audio/*", "video/*", ".json,.txt", "application/pdf"]) expect(acceptsImages(accept)).toBe(false);
  expect(matchesOriginalAccept({name:"photo.HEIC",type:""}, "image/*")).toBe(true);
  expect(matchesOriginalAccept({name:"sound.wav",type:"audio/wav"}, "image/*,audio/*")).toBe(true);
  expect(matchesOriginalAccept({name:"picture.exe",type:"application/x-msdownload"}, "image/*")).toBe(false);
});

it("Phone storage keeps the original input, multiple selection and onChange; restores accept before upload", () => {
  render(<ImageSourcePickerBridge />);
  const field = input();
  const received: File[][] = [];
  field.addEventListener("change", () => { expect(field.accept).toBe("image/*"); received.push(Array.from(field.files || [])); });
  open(field);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", {name:"Phone storage"})).toHaveFocus();
  fireEvent.click(screen.getByRole("button", {name:"Phone storage"}));
  expect(field.accept).toBe(`image/*,${PHONE_STORAGE_MIME}`);
  expect(field.multiple).toBe(true);
  const files = [new File(["a"], "a.png", {type:"image/png"}), new File(["b"], "b.jpg", {type:"image/jpeg"})];
  fireEvent.change(field, {target:{files}});
  expect(received).toEqual([files]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("Photos preserves original accepts and lets existing handlers receive the same selected file", () => {
  render(<ImageSourcePickerBridge />); const field = input(".png,.jpg", false); const handler = vi.fn(); field.addEventListener("change", handler);
  open(field); fireEvent.click(screen.getByRole("button", {name:"Photos / Google Photos"}));
  expect(field.accept).toBe(".png,.jpg"); expect(field.multiple).toBe(false);
  fireEvent.change(field, {target:{files:[new File(["a"], "a.jpg", {type:"image/jpeg"})]}}); expect(handler).toHaveBeenCalledTimes(1);
});

it("supports late-mounted and hidden programmatic inputs used by H3 and Character uploads", () => {
  render(<ImageSourcePickerBridge />); const field = input(); field.hidden = true; open(field);
  fireEvent.click(screen.getByRole("button", {name:"Cancel"})); expect(field.accept).toBe("image/*");
  open(field); fireEvent.click(screen.getByRole("button", {name:"Phone storage"}));
  fireEvent(field, new Event("cancel", {bubbles:true})); expect(field.accept).toBe("image/*");
  open(field); expect(screen.getByRole("dialog")).toBeVisible(); fireEvent.keyDown(document, {key:"Escape"}); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not intercept desktop, explicit camera, disabled, audio-only or video-only selection", () => {
  const view = render(<ImageSourcePickerBridge />);
  for (const accept of ["audio/*", "video/*", ".pdf"]) input(accept).click();
  const camera = input(); camera.setAttribute("capture", "environment"); camera.click();
  const disabled = input(); disabled.disabled = true; disabled.click(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.unmount(); vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Desktop Chrome"); render(<ImageSourcePickerBridge />); input().click(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("rejects unsupported local file types before existing uploader sees them", () => {
  render(<ImageSourcePickerBridge />); const field = input(); const handler = vi.fn(); field.addEventListener("change", handler);
  open(field); fireEvent.click(screen.getByRole("button", {name:"Phone storage"}));
  fireEvent.change(field, {target:{files:[new File(["bad"], "not-an-image.exe", {type:"application/x-msdownload"})]}});
  expect(handler).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("not supported"); expect(field.accept).toBe("image/*");
});

it("mixed inputs retain audio and video; synthetic in-app Gallery changes are untouched", () => {
  render(<ImageSourcePickerBridge />); const field = input("image/*,video/*,audio/*"); const handler = vi.fn(); field.addEventListener("change", handler);
  open(field); fireEvent.click(screen.getByRole("button", {name:"Phone storage"})); fireEvent.change(field, {target:{files:[new File(["a"], "video.mp4", {type:"video/mp4"})]}});
  fireEvent.change(field, {target:{files:[new File(["b"], "from-character.png", {type:"image/png"})]}}); expect(handler).toHaveBeenCalledTimes(2);
});

it("cleans up accept and listeners on unmount without overwriting a newly changed filter", () => {
  let view = render(<ImageSourcePickerBridge />); const field = input(null); open(field); fireEvent.click(screen.getByRole("button", {name:"Phone storage"})); view.unmount(); expect(field.hasAttribute("accept")).toBe(false);
  view = render(<ImageSourcePickerBridge />); field.accept = "image/*"; open(field); fireEvent.click(screen.getByRole("button", {name:"Phone storage"})); field.accept = "video/*"; view.unmount(); expect(field.accept).toBe("video/*"); field.accept = "image/*"; open(field); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("traps keyboard focus within the compact source dialog", () => {
  render(<ImageSourcePickerBridge />); open(input()); const cancel = screen.getByRole("button", {name:"Cancel"}); cancel.focus(); fireEvent.keyDown(document, {key:"Tab"}); expect(screen.getByRole("button", {name:"Phone storage"})).toHaveFocus(); fireEvent.keyDown(document, {key:"Tab",shiftKey:true}); expect(cancel).toHaveFocus();
});
