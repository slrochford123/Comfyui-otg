"use client";
import {Children,cloneElement,isValidElement,useId,type ReactElement,type ReactNode,type ButtonHTMLAttributes} from "react";
import type { Asset } from "@/lib/productionStudio/model";
export const inputClass =
  "w-full min-w-0 rounded-xl border border-white/15 bg-black/30 p-3 text-white";
export function Button({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium disabled:opacity-40 ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId=useId();
  const labelControls=(nodes:ReactNode):ReactNode=>Children.map(nodes,node=>{
    if(!isValidElement(node)||typeof node.type!=="string")return node;
    const element=node as ReactElement<Record<string,unknown>>;
    if(["input","select","textarea"].includes(node.type))return cloneElement(element,{"aria-labelledby":labelId});
    return element.props.children?cloneElement(element,{},labelControls(element.props.children as ReactNode)):element;
  });
  return (
    <label className="block min-w-0 space-y-1 text-sm">
      <span id={labelId} className="text-white/70">{label}</span>
      {labelControls(children)}
    </label>
  );
}
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/15 p-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}
export const mediaUrl = (project: string, asset: string) =>
  `/api/production-studio/projects/${project}/media/${asset}`;
export const previewUrl = (project: string, id: string, assets: Asset[]) =>
  mediaUrl(project, assets.find((a) => a.metadata.proxyFor === id)?.id || id);
