export default function EditVideoAudioPanel({ videoPath }: { videoPath: string }) {
  async function call(route: string) {
    const res = await fetch(route, {
      method: "POST",
      body: JSON.stringify({ videoPath }),
      headers: { "Content-Type": "application/json" }
    });
    const json = await res.json();
    alert(json.output);
  }

  return (
    <div>
      <button onClick={() => call("/api/edit-video/remove-music")}>Remove Music</button>
      <button onClick={() => call("/api/edit-video/enhance-audio")}>Enhance Audio</button>
      <button onClick={() => call("/api/edit-video/remove-enhance")}>Remove + Enhance</button>
    </div>
  );
}
