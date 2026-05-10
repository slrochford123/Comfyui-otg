"use client"
import React from "react"

export const workflows = [
  {
    id: "anime_realism",
    label: "Anime to Realism — ~1 min",
    workflow: "anime_to_realism.json"
  },
  {
    id: "zimage",
    label: "Create Picture — ~1 min",
    workflow: "z_image.json"
  },
  {
    id: "zimage_turbo",
    label: "Create Picture Turbo — ~15 sec",
    workflow: "image_z_image_turbo.json"
  },
  {
    id: "ltx23_t2v",
    label: "Create Video — ~2 min 30 sec",
    workflow: "video_ltx2_3_t2v.json"
  },
  {
    id: "ltx23_i2v",
    label: "Create Video from Picture — ~2 min",
    workflow: "video_ltx2_3_i2v.json"
  },
  {
    id: "edit_image",
    label: "Edit Picture — ~30 sec",
    workflow: "edit_picture.json"
  }
]

export default function GenerateWorkflowSelector({value,onChange}:{value:string,onChange:(v:string)=>void}){

  return (
    <select
      value={value}
      onChange={(e)=>onChange(e.target.value)}
      className="w-full p-3 rounded-xl bg-black/40 border border-white/10 text-white font-semibold"
    >
      {workflows.map(w=>(
        <option key={w.id} value={w.id}>
          {w.label}
        </option>
      ))}
    </select>
  )
}
