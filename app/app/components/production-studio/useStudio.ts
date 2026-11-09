"use client";
import {selectedAssistantProvider} from "../AssistantProviderPicker";
import { useCallback, useEffect, useRef, useState } from "react";
import { newClientRequestId } from "@/lib/client/requestId";
import {
  allShots,
  DEFAULT_SHOT,
  type Project,
  type Asset,
  type Job,
  type Operation,
} from "@/lib/productionStudio/model";
export async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(
      "The server could not return this production. Your local draft is kept.",
    );
  }
  if (!r.ok) {
    const e = Object.assign(new Error(data.error || "Request failed"), {
      status: r.status,
    });
    throw e;
  }
  return data;
}
function apply(p: Project, ops: Operation[]) {
  const result = structuredClone(p);
  for (const op of ops) {
    if (op.type === "brief") {
      const { name, ...brief } = op.patch as Partial<Project["brief"]> & {
        name?: string;
      };
      if (name !== undefined) result.name = name;
      Object.assign(result.brief, brief);
    } else if (op.type === "shot.patch") {
      const shot = allShots(result).find((s) => s.id === op.shotId);
      if (shot) Object.assign(shot, op.patch);
    } else if(op.type === "shot.direction.save") {
      const id=String(op.shotId),settings=result.shots[id]||DEFAULT_SHOT;
      result.shots[id]={...settings,direction:{version:1,brief:op.brief as NonNullable<typeof settings.direction>["brief"],history:settings.direction?.history||[],imageChange:settings.direction?.imageChange}};
    } else if (op.type === "scene.patch") {
      const scene = result.plan.acts
        .flatMap((a) => a.scenes)
        .find((s) => s.id === op.sceneId);
      if (scene) Object.assign(scene, op.patch);
    } else if (op.type === "shot.settings") {
      const id = String(op.shotId);
      result.shots[id] = {
        ...(result.shots[id] || DEFAULT_SHOT),
        ...(op.patch as object),
      };
    } else if (op.type === "timeline.set")
      result.timeline = op.timeline as Project["timeline"];
    else if(op.type==="workflow.navigate")result.workflow={version:2,workspace:op.workspace as NonNullable<Project['workflow']>['workspace'],clipId:String(op.clipId||result.workflow?.clipId||'')||undefined};
    else if(op.type==="clip.edit.timeline"){
      const id=String(op.shotId),old=result.clipEdits?.[id];
      if(old){result.clipEdits={...result.clipEdits,[id]:{...old,timeline:op.timeline as Project['timeline']}};}
    }
    else if(op.type==="clip.edit.prompt"){
      const id=String(op.shotId),old=result.clipEdits?.[id];if(old)result.clipEdits={...result.clipEdits,[id]:{...old,videoPrompt:String(op.prompt)}};
    }
  }
  return result;
}
export function useStudio(ownerKey: string, id: string) {
  const [project, setProject] = useState<Project | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [creationCurrent, setCreationCurrent] = useState<boolean | undefined>(undefined),
    [status, setStatus] = useState("Loading"),
    [error, setError] = useState("");
  const base = useRef<Project | null>(null),
    pending = useRef<Operation[]>([]),
    busy = useRef(false),
    blocked = useRef(false),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `otg:production-studio:v1:${ownerKey}:${id}`,
    url = `/api/production-studio/projects/${id}`;
  const persist = useCallback(() => {
    try {
      if (pending.current.length)
        localStorage.setItem(
          key,
          JSON.stringify({
            revision: base.current?.revision,
            operations: pending.current,
            snapshot: base.current,
          }),
        );
      else localStorage.removeItem(key);
    } catch {
      setError(
        "Device recovery storage is full. Keep this page open until server saving succeeds.",
      );
    }
  }, [key]);
  const flush = useCallback(async () => {
    if (
      busy.current ||
      blocked.current ||
      !base.current ||
      !pending.current.length ||
      !alive.current
    )
      return;
    busy.current = true;
    setStatus("Saving");
    try {
      while (pending.current.length && alive.current) {
        const response = await request(url, {
          method: "PATCH",
          body: JSON.stringify({
            revision: base.current!.revision,
            operation: pending.current[0],
          }),
        });
        if (!alive.current) return;
        base.current = response.project;
        pending.current.shift();
        persist();
        setProject(apply(response.project, pending.current));
      }
      if (alive.current) setStatus("Saved");
    } catch (e) {
      if (!alive.current) return;
      blocked.current = (e as { status?: number }).status === 409;
      setStatus(
        blocked.current ? "Conflict · draft kept" : "Offline · draft kept",
      );
      setError(e instanceof Error ? e.message : "Could not save");
      persist();
    } finally {
      busy.current = false;
    }
  }, [url, persist]);
  const refresh = useCallback(async () => {
    const data = await request(url);
    if (!alive.current) return;
    // A poll begun before a successful save must not roll back its revision,
    // references or job state when its slower response arrives afterwards.
    if(base.current?.id===data.project.id&&data.project.revision<base.current!.revision)return;
    setAssets(data.assets);
    setJobs(data.jobs);
    setCreationCurrent(data.creationCurrent);
    if (!pending.current.length && !busy.current) {
      base.current = data.project;
      setProject(data.project);
      setStatus("Saved");
    }
  }, [url]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void request(url, { signal: controller.signal })
      .then((data) => {
        if (!alive.current) return;
        base.current = data.project;
        setAssets(data.assets);
        setJobs(data.jobs);
        setCreationCurrent(data.creationCurrent);
        try {
          const recovered = JSON.parse(localStorage.getItem(key) || "null");
          if (recovered?.operations?.length) {
            pending.current = recovered.operations;
            blocked.current = recovered.revision !== data.project.revision;
            setStatus(
              blocked.current ? "Recovery needs review" : "Recovered draft",
            );
            if (blocked.current)
              setError(
                "This device has unsaved changes based on an older revision. Review before reapplying.",
              );
          }
        } catch {}
        setProject(apply(data.project, pending.current));
        if (!pending.current.length) setStatus("Saved");
        if (!blocked.current) void flush();
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    const poll = setInterval(() => void refresh().catch(() => {}), 5000);
    const online = () => {
      if (!blocked.current) void flush();
    };
    window.addEventListener("online", online);
    const storageError = () =>
      setError(
        "Device recovery storage is full. Keep the app open until server saving succeeds.",
      );
    window.addEventListener("production-studio-storage-error", storageError);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(poll);
      clearTimeout(timer.current);
      window.removeEventListener("online", online);
      window.removeEventListener(
        "production-studio-storage-error",
        storageError,
      );
    };
  }, [url, key, flush, refresh]);
  const change = useCallback(
    (op: Operation) => {
      if (!base.current) return;
      const last = pending.current.at(-1);
      if (
        !busy.current &&
        last?.type === op.type &&
        ["brief", "shot.patch", "shot.settings", "scene.patch"].includes(
          op.type,
        ) &&
        last.shotId === op.shotId &&
        last.sceneId === op.sceneId
      ) {
        last.patch = { ...(last.patch as object), ...(op.patch as object) };
      } else pending.current.push(op);
      persist();
      setProject(apply(base.current, pending.current));
      setStatus("Unsaved");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 450);
    },
    [persist, flush],
  );
  const reapply = async () => {
    if (busy.current) return;
    const data = await request(url);
    base.current = data.project;
    blocked.current = false;
    setProject(apply(data.project, pending.current));
    setError("");
    persist();
    await flush();
  };
  const job = async (payload: Record<string, unknown>) => {
    await flush();
    if (pending.current.length || !base.current)
      throw new Error("Resolve unsaved changes first.");
    await request(url + "/jobs", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        aiProvider:payload.aiProvider??selectedAssistantProvider("production:"+ownerKey+":"+id),
        revision: base.current.revision,
        approved: true,
        requestKey: newClientRequestId(),
      }),
    });
    await refresh();
  };
  const commit = async (operation: Operation) => {
    await flush();
    if (busy.current || pending.current.length || blocked.current || !base.current)
      throw new Error("Resolve unsaved changes before saving this scene. Your local draft is kept.");
    // Explicit approval actions must not poison autosave with a rejected operation.
    // Scene typing is separately recoverable in useStoredDraft until this succeeds.
    busy.current = true;
    setStatus("Saving");
    try {
      const response = await request(url, {method:"PATCH",body:JSON.stringify({revision:base.current.revision,operation})});
      base.current = response.project;
      if (alive.current) setProject(apply(response.project, pending.current));
      persist();
    } finally {
      busy.current = false;
      if (alive.current) {
        setStatus(pending.current.length ? "Unsaved" : "Saved");
        if (pending.current.length) void flush();
      }
    }
  };
  const action = async (path: string,payload:Record<string,unknown>) => {
    await flush();
    if(busy.current||pending.current.length||blocked.current||!base.current)throw new Error("Resolve unsaved edits first. Your draft is kept.");
    busy.current=true;setStatus("Saving");
    try{const data=await request(url+path,{method:"POST",body:JSON.stringify({...payload,revision:base.current.revision})});if(data.project){base.current=data.project;if(alive.current)setProject(data.project);}return data;}
    finally{busy.current=false;if(alive.current){setStatus(pending.current.length?"Unsaved":"Saved");await refresh();}}
  };
  return {
    scopeKey: key,
    project,
    assets,
    jobs,
    creationCurrent,
    status,
    error,
    setError,
    change,
    refresh,
    flush,
    reapply,
    job,
    commit,
    action,
    url,
    saved: status === "Saved",
    request,
  };
}
