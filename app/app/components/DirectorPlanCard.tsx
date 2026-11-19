"use client";
import type { DirectorPlan } from "@/lib/experiments/director3060";
const button = "min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm";
function sceneText(shot: DirectorPlan["shots"][number]) {
  return `${shot.prompt}\nSound: ${shot.sound}`;
}
function planText(plan: DirectorPlan) {
  return [plan.title, plan.continuity, ...plan.shots.map((shot, index) => `${index + 1}. ${shot.title} · ${shot.seconds}s\n${sceneText(shot)}`)].join("\n\n");
}
export default function DirectorPlanCard({ plan, onCopy }: { plan: DirectorPlan; onCopy: (text: string) => void }) {
  return <details className="rounded-lg border border-white/15 p-3" open>
    <summary className="cursor-pointer font-semibold">{plan.title}</summary>
    <p className="my-2 whitespace-pre-wrap text-sm">{plan.continuity}</p>
    <button className={button} onClick={() => onCopy(planText(plan))}>Copy plan to clipboard</button>
    <ol className="list-decimal space-y-3 pl-5">{plan.shots.map((shot, index) => <li key={index} className="mt-3 text-sm">
      <strong>{shot.title} · {shot.seconds}s</strong>
      <p className="mt-1 whitespace-pre-wrap">{shot.prompt}</p>
      <p className="mt-1 whitespace-pre-wrap text-white/70">Sound: {shot.sound}</p>
      <button className={`${button} mt-2`} onClick={() => onCopy(sceneText(shot))}>Copy scene {index + 1}</button>
    </li>)}</ol>
  </details>;
}
