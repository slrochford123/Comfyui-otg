/** Read-only validation of the exact prepared graph against its assigned worker.
 * This is NOT permission to retarget: upload identity, parent/history ownership,
 * custom-node semantics and measured VRAM requirements remain caller contracts.
 */
type NodeSchema = {python_module?: unknown; input?: Record<string, Record<string, unknown>>};
type UploadedInput = {key:string; filename:string; subfolder:string; media:"image"|"audio"};

// Core LoadImage/LoadAudio validate file existence, not combo membership. Their
// dropdowns list only top-level input files, omitting valid subfolder uploads.
// Do not apply this exception to model selectors or arbitrary custom loaders.
function uploadedInput(id:string, classType:unknown, schema:NodeSchema, name:string, value:unknown, spec:unknown):UploadedInput|null {
  if (!Array.isArray(spec) || typeof value !== "string") return null;
  const options=spec[1] as Record<string,unknown>|undefined;
  const media=classType==="LoadImage" && schema.python_module==="nodes" && name==="image" && options?.image_upload===true ? "image"
    : classType==="LoadAudio" && schema.python_module==="comfy_extras.nodes_audio" && name==="audio" && options?.audio_upload===true ? "audio" : null;
  if (!media) return null;
  const relative=value.replace(/ \[input\]$/, "");
  // Probe only input-root-relative paths, never URLs, traversal, other roots,
  // encoded separators, or platform-specific path spellings.
  if (!relative || /[\\\x00-\x1f:%\[\]]/.test(relative) || relative.split("/").some(part=>!part||part==="."||part==="..")) return null;
  const parts=relative.split("/"),filename=parts.pop()!;
  return {key:JSON.stringify([id,name,value]),filename,subfolder:parts.join("/"),media};
}

function graphProblems(graph: unknown, inventory: unknown, verifiedUploads:ReadonlySet<string>): string[] {
  if (!graph || typeof graph !== "object" || Array.isArray(graph) || !Object.keys(graph).length)
    return ["A nonempty API graph is required."];
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory))
    return ["Worker node inventory is unavailable."];
  const nodes = graph as Record<string, {class_type?: unknown; inputs?: unknown}>;
  const schemas = inventory as Record<string, NodeSchema>;
  const problems: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node.class_type !== "string" || !Object.hasOwn(schemas, node.class_type)) {
      problems.push(`Node ${id}: exact node class is unavailable.`); continue;
    }
    const schema = schemas[node.class_type];
    if (!schema?.input || !node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
      problems.push(`Node ${id}: input schema cannot be verified.`); continue;
    }
    const specs = {...schema.input.required, ...schema.input.optional};
    for (const [name, value] of Object.entries(node.inputs)) {
      // Links are graph edges, never model names or staged filenames.
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1])) {
        if (!Object.hasOwn(nodes, value[0])) problems.push(`Node ${id}.${name}: source node is missing.`);
        continue;
      }
      const spec = specs[name];
      const upload=uploadedInput(id,node.class_type,schema,name,value,spec);
      if (upload && verifiedUploads.has(upload.key)) continue;
      if (Array.isArray(spec) && Array.isArray(spec[0]) && !spec[0].includes(value))
        problems.push(`Node ${id}.${name}: exact selected value is unavailable on the assigned worker.`);
      else if (Array.isArray(spec) && spec[0]==="COMBO" && (spec[1]?.image_upload || spec[1]?.audio_upload)
        && Array.isArray(spec[1]?.options) && !spec[1].options.includes(value))
        problems.push(`Node ${id}.${name}: exact selected value is unavailable on the assigned worker.`);
    }
  }
  return problems;
}

export function preparedComfyGraphProblems(graph:unknown, inventory:unknown):string[] {
  return graphProblems(graph,inventory,new Set());
}

export async function qualifyPreparedComfyGraph(baseUrl: string, graph: unknown): Promise<void> {
  const response = await fetch(`${baseUrl}/object_info`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error(`Cannot verify the assigned worker's node/model inventory (HTTP ${response.status}).`);
  const inventory=await response.json() as Record<string,NodeSchema>, verifiedUploads=new Set<string>();
  const verifiedPaths=new Map<string,boolean>();
  if (graph && typeof graph==="object" && !Array.isArray(graph) && inventory && typeof inventory==="object") {
    for (const [id,node] of Object.entries(graph)) {
      if (!node || typeof node.class_type!=="string" || !Object.hasOwn(inventory,node.class_type)) continue;
      const schema=inventory[node.class_type];
      if (!schema?.input || !node.inputs || typeof node.inputs!=="object") continue;
      const specs={...schema.input.required,...schema.input.optional};
      for (const [name,value] of Object.entries(node.inputs)) {
        const spec=specs[name];
        const upload=uploadedInput(id,node.class_type,schema,name,value,spec);
        if (!upload) continue;
        const choices=Array.isArray(spec) ? Array.isArray(spec[0]) ? spec[0] : spec[1]?.options : undefined;
        if (Array.isArray(choices) && choices.includes(value)) continue;
        const url=new URL(`${baseUrl.replace(/\/+$/,"")}/view`);
        url.searchParams.set("type","input");url.searchParams.set("filename",upload.filename);url.searchParams.set("subfolder",upload.subfolder);
        const key=upload.media+":"+url.href;
        if (!verifiedPaths.has(key)) {
          try {
            // HEAD is implemented by both qualified Comfy servers. It proves
            // the assigned worker can serve the exact file without reading a
            // large image/audio body or submitting any GPU work.
            const file=await fetch(url,{method:"HEAD",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000)});
            const type=file.headers.get("content-type")||"",bytes=Number(file.headers.get("content-length"));
            verifiedPaths.set(key,file.status===200 && bytes>0 && (upload.media==="image"?type.startsWith("image/"):/^(audio|video)\//.test(type)));
          } catch { verifiedPaths.set(key,false); }
        }
        if (verifiedPaths.get(key)) verifiedUploads.add(upload.key);
      }
    }
  }
  const problems = graphProblems(graph, inventory, verifiedUploads);
  if (problems.length) throw Error(`Prepared Comfy graph was not submitted: ${problems.slice(0, 8).join(" ")}`);
}
