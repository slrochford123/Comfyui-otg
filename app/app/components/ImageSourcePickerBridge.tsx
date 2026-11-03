"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acceptsImages, matchesOriginalAccept, phoneStorageAccept } from "@/lib/client/imageSources";
import {externalGoogleWindow,pickGooglePhotos} from "@/lib/client/googlePhotos";

type Selection = { input: HTMLInputElement; accept: string | null; trigger: HTMLElement | null };

/** One bridge for every image-capable file input, including lazy tabs and hidden inputs.
 * The original input and its upload handler still own the selected File objects.
 */
export default function ImageSourcePickerBridge() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [cloudStatus,setCloudStatus]=useState("");
  const cloudAbort=useRef<AbortController|null>(null);
  const pending = useRef<Selection | null>(null);
  const launched = useRef<(Selection & { temporary: string }) | null>(null);
  const bypass = useRef(new WeakSet<HTMLInputElement>());
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      const current = launched.current;
      if (!current || current.input.getAttribute("accept") !== current.temporary) return;
      if (current.accept === null) current.input.removeAttribute("accept");
      else current.input.setAttribute("accept", current.accept);
    };
    const click = (event: MouseEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (bypass.current.has(input)) { bypass.current.delete(input); return; }
      if (input.disabled || input.hasAttribute("capture") || (!acceptsImages(input.accept) && !input.accept.includes("video/"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (cloudAbort.current) return;
      clearTimeout(focusTimer);
      restore();
      launched.current = null;
      const next = { input, accept: input.getAttribute("accept"), trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      pending.current = next;
      setError("");
      setSelection(next);
    };
    const change = (event: Event) => {
      const current = launched.current;
      if (!current || event.target !== current.input) return;
      restore();
      launched.current = null;
      if (Array.from(current.input.files || []).some(file => !matchesOriginalAccept(file, current.accept || ""))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        current.input.value = "";
        setError("That file type is not supported here. Please choose a supported image or media file.");
      }
    };
    const cancel = (event: Event) => {
      if (event.target !== launched.current?.input) return;
      restore();
      launched.current = null;
    };
    // Older WebViews do not emit cancel. Restore the filter after returning, but
    // retain validation until change; focus can precede the file-selection event.
    const focus = () => { clearTimeout(focusTimer); focusTimer = setTimeout(restore, 800); };
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("cancel", cancel, true);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", restore);
    return () => {
      cloudAbort.current?.abort();
      clearTimeout(focusTimer);
      restore();
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("cancel", cancel, true);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", restore);
    };
  }, []);

  useEffect(() => {
    if (!selection && !error) return;
    const previous = document.activeElement;
    const target = dialog.current;
    target?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault();cloudAbort.current?.abort();pending.current = null; setSelection(null); setError("");setCloudStatus(""); }
      if (event.key !== "Tab" || !target) return;
      const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [selection, error]);

  function choose(local: boolean) {
    const current = pending.current;
    pending.current = null;
    setSelection(null);
    if (!current?.input.isConnected || current.input.disabled) return;
    if (local) {
      const temporary = phoneStorageAccept(current.accept || "");
      launched.current = { ...current, temporary };
      current.input.setAttribute("accept", temporary);
    }
    bypass.current.add(current.input);
    current.input.click();
  }

  async function chooseGoogle(){
    const current=pending.current;if(!current||cloudAbort.current)return;
    const popup=externalGoogleWindow(),abort=new AbortController();cloudAbort.current=abort;
    setCloudStatus("Opening Google Photos…");setError("");
    try{
      const files=await pickGooglePhotos(current.input,popup,abort.signal,setCloudStatus);
      abort.signal.throwIfAborted();
      if(!files.length){pending.current=null;setSelection(null);setCloudStatus("");return;}
      if(files.some(file=>!matchesOriginalAccept(file,current.accept||"")))throw Error("Choose only the file types supported here. Nothing was added.");
      if(!current.input.isConnected||current.input.disabled)throw Error("The input changed while picking. Choose your media again.");
      const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));current.input.files=transfer.files;
      pending.current=null;setSelection(null);setCloudStatus("");
      current.input.dispatchEvent(new Event("change",{bubbles:true}));
    }catch(error){
      if(abort.signal.aborted||(error as Error).name==="AbortError"){pending.current=null;setSelection(null);}
      else setError((error as Error).message);
      setCloudStatus("");
    }
    finally{if(cloudAbort.current===abort)cloudAbort.current=null;}
  }

  if (!selection && !error) return null;
  const close = () => { cloudAbort.current?.abort();pending.current = null; setSelection(null); setError("");setCloudStatus(""); };
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="image-source-title" className="w-full max-w-sm rounded-2xl border border-slate-600 bg-slate-950 p-5 text-white shadow-xl">
        <h2 id="image-source-title" className="mb-4 text-lg font-semibold">{error ? "Choose another file" : "Add image or media"}</h2>
        {error ? <p role="alert" className="mb-4 text-sm text-amber-200">{error}</p> : cloudStatus?<p role="status" className="mb-4 text-sm">{cloudStatus}</p>:<div className="grid gap-3">
          <button type="button" className="min-h-12 rounded-xl bg-violet-600 px-4 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => choose(true)}>Phone storage</button>
          <button type="button" className="min-h-12 rounded-xl border border-slate-500 px-4 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => choose(false)}>Photos / Google Photos</button>
          <button type="button" className="min-h-12 rounded-xl border border-slate-500 px-4 py-3 font-semibold" onClick={()=>void chooseGoogle()}>Connected Google Photos</button>
          <p className="text-xs text-slate-300">Connect your Google account in Settings to import cloud photos and videos.</p>
          <p className="text-xs text-slate-300">In Files, choose Images, Pictures, DCIM or Downloads.</p>
        </div>}
        <button type="button" className="mt-3 min-h-12 w-full rounded-xl px-4 py-3 text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={close}>{error ? "Close" : "Cancel"}</button>
      </div>
    </div>, document.body,
  );
}
