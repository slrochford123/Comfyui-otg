import io
import os

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response, JSONResponse

# rembg uses U2Net (default) and downloads the model on first run into the user cache.
from rembg import remove


app = FastAPI(title="OTG Background Removal", version="1.0")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/remove-bg")
async def remove_bg(image: UploadFile = File(...)):
    try:
        data = await image.read()
        if not data:
            return JSONResponse({"error": "Empty upload"}, status_code=400)

        # rembg returns bytes (PNG with alpha) when input is bytes
        out = remove(data)
        if not out:
            return JSONResponse({"error": "Background removal returned empty output"}, status_code=500)

        return Response(content=out, media_type="image/png", headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    # For local debugging only. Use the provided run scripts for normal use.
    import uvicorn

    host = os.environ.get("BG_REMOVE_HOST", "127.0.0.1")
    port = int(os.environ.get("BG_REMOVE_PORT", "3333"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
