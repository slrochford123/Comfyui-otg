import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


HY3D_ROOT = Path(r"C:\AI\Hunyuan3D\Hunyuan3D-2.1")
HY3D_SHAPE_ROOT = HY3D_ROOT / "hy3dshape"
HY3D_PAINT_ROOT = HY3D_ROOT / "hy3dpaint"
DEFAULT_MODEL = "tencent/Hunyuan3D-2.1"


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}, indent=2))
    raise SystemExit(code)


def clean_character_id(value: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_") else "-" for c in value.strip()).strip("-_")


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def prepare_hy3d_paths() -> None:
    sys.path.insert(0, str(HY3D_ROOT))
    sys.path.insert(0, str(HY3D_PAINT_ROOT))
    sys.path.insert(0, str(HY3D_SHAPE_ROOT))
    os.chdir(str(HY3D_ROOT))


def disable_missing_mesh_inpaint() -> Dict[str, Any]:
    """
    Hunyuan3D Paint can run without the optional mesh inpaint extension.
    When meshVerticeInpaint is missing, ViewProcessor.texture_inpaint raises a NameError.
    This patch preserves texture generation by returning the baked texture unchanged.
    """
    try:
        from utils import pipeline_utils
    except Exception as exc:
        return {
            "enabled": False,
            "reason": f"Could not import utils.pipeline_utils: {type(exc).__name__}: {exc}",
        }

    view_processor_cls = getattr(pipeline_utils, "ViewProcessor", None)
    if view_processor_cls is None:
        return {
            "enabled": False,
            "reason": "utils.pipeline_utils.ViewProcessor was not found.",
        }

    original_texture_inpaint = getattr(view_processor_cls, "texture_inpaint", None)
    if not callable(original_texture_inpaint):
        return {
            "enabled": False,
            "reason": "ViewProcessor.texture_inpaint is not callable.",
        }

    if getattr(view_processor_cls, "_otg_safe_inpaint_patch", False):
        return {
            "enabled": True,
            "alreadyPatched": True,
            "mode": "skip-missing-meshVerticeInpaint",
        }

    def safe_texture_inpaint(self, texture, mask_np, *args, **kwargs):
        try:
            return original_texture_inpaint(self, texture, mask_np, *args, **kwargs)
        except NameError as exc:
            if "meshVerticeInpaint" in str(exc):
                print(
                    "[hy3dpaint] meshVerticeInpaint is unavailable; using baked texture without mesh inpaint.",
                    flush=True,
                )
                return texture
            raise

    setattr(view_processor_cls, "texture_inpaint", safe_texture_inpaint)
    setattr(view_processor_cls, "_otg_safe_inpaint_patch", True)

    return {
        "enabled": True,
        "alreadyPatched": False,
        "mode": "skip-missing-meshVerticeInpaint",
    }

def estimate_border_background_rgb(image: Any) -> Tuple[int, int, int]:
    rgb = image.convert("RGB")
    sample = rgb.copy()
    sample.thumbnail((256, 256))

    width, height = sample.size
    pixels: List[Tuple[int, int, int]] = []

    if width <= 0 or height <= 0:
        return (255, 255, 255)

    for x in range(width):
        pixels.append(sample.getpixel((x, 0)))
        pixels.append(sample.getpixel((x, height - 1)))

    for y in range(height):
        pixels.append(sample.getpixel((0, y)))
        pixels.append(sample.getpixel((width - 1, y)))

    if not pixels:
        return (255, 255, 255)

    r = int(sum(pixel[0] for pixel in pixels) / len(pixels))
    g = int(sum(pixel[1] for pixel in pixels) / len(pixels))
    b = int(sum(pixel[2] for pixel in pixels) / len(pixels))

    return (r, g, b)


def centered_full_body_bbox(width: int, height: int, width_fraction: float = 0.62) -> Tuple[int, int, int, int]:
    crop_width = int(width * width_fraction)
    center_x = int(width / 2)

    left = clamp(center_x - int(crop_width / 2), 0, width)
    right = clamp(center_x + int(crop_width / 2), 0, width)
    top = int(height * 0.015)
    bottom = int(height * 0.99)

    return (left, top, right, bottom)


def mask_bbox_from_pil(mask: Any) -> Optional[Tuple[int, int, int, int]]:
    bbox = mask.getbbox()
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


def make_pil_fallback_mask(rgba: Any, threshold: int) -> Tuple[Any, Dict[str, Any]]:
    from PIL import Image, ImageChops, ImageFilter, ImageOps

    width, height = rgba.size
    rgb = rgba.convert("RGB")

    background_rgb = estimate_border_background_rgb(rgba)
    background = Image.new("RGB", rgb.size, background_rgb)

    diff = ImageChops.difference(rgb, background).convert("L")
    diff_mask = diff.point(lambda value: 255 if value >= threshold else 0)

    gray = ImageOps.grayscale(rgb)
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = edges.point(lambda value: 255 if value >= max(18, int(threshold * 0.75)) else 0)

    if "A" in rgba.getbands():
        alpha = rgba.getchannel("A")
        alpha_mask = alpha.point(lambda value: 255 if value > 12 else 0)
        diff_mask = ImageChops.lighter(diff_mask, alpha_mask)

    border_margin_x = max(2, int(width * 0.04))
    border_margin_y = max(2, int(height * 0.04))

    cleaned = Image.new("L", diff_mask.size, 0)
    inner_box = (
        border_margin_x,
        border_margin_y,
        width - border_margin_x,
        height - border_margin_y,
    )

    if inner_box[2] > inner_box[0] and inner_box[3] > inner_box[1]:
        inner = diff_mask.crop(inner_box)
        cleaned.paste(inner, (border_margin_x, border_margin_y))
    else:
        cleaned = diff_mask

    cleaned = ImageChops.lighter(cleaned, edges)
    cleaned = cleaned.filter(ImageFilter.MaxFilter(9))
    cleaned = cleaned.filter(ImageFilter.MinFilter(5))
    cleaned = cleaned.filter(ImageFilter.MaxFilter(5))
    cleaned = cleaned.point(lambda value: 255 if value >= 24 else 0)

    return cleaned, {
        "method": "pil-fallback",
        "backgroundRgb": list(background_rgb),
        "borderMargin": [border_margin_x, border_margin_y],
    }


def make_rembg_mask(rgba: Any) -> Tuple[Any, Dict[str, Any]]:
    from PIL import ImageFilter

    try:
        prepare_hy3d_paths()
        from hy3dshape.rembg import BackgroundRemover

        remover = BackgroundRemover()

        try:
            removed = remover(rgba)
        except Exception:
            removed = remover(rgba.convert("RGB"))

        removed = removed.convert("RGBA")
        alpha = removed.getchannel("A")

        mask = alpha.point(lambda value: 255 if value > 12 else 0)
        mask = mask.filter(ImageFilter.MaxFilter(5))
        mask = mask.filter(ImageFilter.MinFilter(3))
        mask = mask.point(lambda value: 255 if value >= 24 else 0)

        bbox = mask.getbbox()

        return mask, {
            "method": "rembg",
            "rembgAvailable": True,
            "bbox": list(bbox) if bbox else None,
        }
    except Exception as exc:
        fallback_mask, fallback_diag = make_pil_fallback_mask(rgba, 28)
        fallback_diag["rembgAvailable"] = False
        fallback_diag["rembgError"] = f"{type(exc).__name__}: {exc}"
        return fallback_mask, fallback_diag

def make_grabcut_mask(rgba: Any) -> Tuple[Any, Dict[str, Any]]:
    from PIL import Image, ImageFilter

    try:
        import cv2
        import numpy as np
    except Exception as exc:
        fallback_mask, fallback_diag = make_pil_fallback_mask(rgba, 28)
        fallback_diag["grabcutAvailable"] = False
        fallback_diag["grabcutError"] = f"{type(exc).__name__}: {exc}"
        return fallback_mask, fallback_diag

    width, height = rgba.size
    rgb = rgba.convert("RGB")

    image_rgb = np.array(rgb)
    image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

    mask = np.full((height, width), cv2.GC_PR_BGD, dtype=np.uint8)

    border_x = max(4, int(width * 0.045))
    border_y = max(4, int(height * 0.035))
    mask[:border_y, :] = cv2.GC_BGD
    mask[height - border_y:, :] = cv2.GC_BGD
    mask[:, :border_x] = cv2.GC_BGD
    mask[:, width - border_x:] = cv2.GC_BGD

    fg_left, fg_top, fg_right, fg_bottom = centered_full_body_bbox(width, height, width_fraction=0.42)
    mask[fg_top:fg_bottom, fg_left:fg_right] = cv2.GC_PR_FGD

    core_left = int(width * 0.39)
    core_right = int(width * 0.61)
    core_top = int(height * 0.06)
    core_bottom = int(height * 0.92)
    mask[core_top:core_bottom, core_left:core_right] = cv2.GC_FGD

    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(image_bgr, mask, None, bg_model, fg_model, 6, cv2.GC_INIT_WITH_MASK)
    except Exception as exc:
        fallback_mask, fallback_diag = make_pil_fallback_mask(rgba, 28)
        fallback_diag["grabcutAvailable"] = True
        fallback_diag["grabcutError"] = f"{type(exc).__name__}: {exc}"
        return fallback_mask, fallback_diag

    foreground = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
        255,
        0,
    ).astype("uint8")

    kernel = np.ones((5, 5), np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel, iterations=1)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=2)

    pil_mask = Image.fromarray(foreground)
    pil_mask = pil_mask.filter(ImageFilter.MaxFilter(5))
    pil_mask = pil_mask.filter(ImageFilter.GaussianBlur(radius=1.1))
    pil_mask = pil_mask.point(lambda value: 255 if value >= 24 else 0)

    return pil_mask, {
        "method": "grabcut",
        "grabcutAvailable": True,
        "border": [border_x, border_y],
        "probableForegroundBox": [fg_left, fg_top, fg_right, fg_bottom],
        "foregroundCore": [core_left, core_top, core_right, core_bottom],
    }


def bbox_with_padding(
    bbox: Tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    crop_padding: float,
) -> Tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    subject_width = max(1, right - left)
    subject_height = max(1, bottom - top)

    pad_x = int(subject_width * crop_padding)
    pad_y = int(subject_height * crop_padding)

    left = clamp(left - pad_x, 0, image_width)
    top = clamp(top - pad_y, 0, image_height)
    right = clamp(right + pad_x, 0, image_width)
    bottom = clamp(bottom + pad_y, 0, image_height)

    return (left, top, right, bottom)


def preprocess_character_image(
    input_path: Path,
    output_path: Path,
    image_size: int,
    threshold: int,
    crop_padding: float,
    segmentation_method: str,
) -> Dict[str, Any]:
    try:
        from PIL import Image, ImageFilter
    except Exception as exc:
        fail(f"Pillow/PIL is required for HY3D preprocessing but could not be imported: {type(exc).__name__}: {exc}")

    image = Image.open(input_path)
    image.load()

    original_width, original_height = image.size
    rgba = image.convert("RGBA")

    if segmentation_method == "rembg":
        mask, mask_diagnostics = make_rembg_mask(rgba)
    elif segmentation_method == "grabcut":
        mask, mask_diagnostics = make_grabcut_mask(rgba)
    elif segmentation_method == "pil":
        mask, mask_diagnostics = make_pil_fallback_mask(rgba, threshold)
    elif segmentation_method == "center":
        mask = Image.new("L", rgba.size, 255)
        mask_diagnostics = {"method": "center"}
    else:
        fail(f"Unknown segmentation method: {segmentation_method}")

    raw_bbox = mask_bbox_from_pil(mask)

    used_center_crop = False
    used_mask_bbox = True

    if raw_bbox is None:
        bbox = centered_full_body_bbox(original_width, original_height, width_fraction=0.62)
        used_center_crop = True
        used_mask_bbox = False
    else:
        left, top, right, bottom = raw_bbox
        area_ratio = ((right - left) * (bottom - top)) / max(1, original_width * original_height)

        if area_ratio > 0.82 or area_ratio < 0.05:
            bbox = centered_full_body_bbox(original_width, original_height, width_fraction=0.62)
            used_center_crop = True
            used_mask_bbox = False
        else:
            bbox = raw_bbox

    if used_center_crop:
        bbox = bbox_with_padding(
            bbox,
            original_width,
            original_height,
            min(crop_padding, 0.035),
        )
    else:
        bbox = bbox_with_padding(
            bbox,
            original_width,
            original_height,
            crop_padding,
        )

    left, top, right, bottom = bbox

    if right <= left or bottom <= top:
        bbox = centered_full_body_bbox(original_width, original_height, width_fraction=0.62)
        left, top, right, bottom = bbox
        used_center_crop = True
        used_mask_bbox = False

    crop = rgba.crop((left, top, right, bottom))
    crop_mask = mask.crop((left, top, right, bottom))

    if used_center_crop:
        neutral = Image.new("RGBA", crop.size, (255, 255, 255, 255))
        neutral.alpha_composite(crop)
        crop = neutral
        canvas_alpha = 255
        paste_mask = None
    else:
        crop_mask = crop_mask.filter(ImageFilter.MaxFilter(3))
        crop.putalpha(crop_mask)
        canvas_alpha = 0
        paste_mask = crop

    crop_width, crop_height = crop.size
    side = max(crop_width, crop_height, 1)

    canvas = Image.new("RGBA", (side, side), (255, 255, 255, canvas_alpha))
    paste_x = int((side - crop_width) / 2)
    paste_y = int((side - crop_height) * 0.52)
    canvas.paste(crop, (paste_x, paste_y), paste_mask)

    if image_size > 0 and side != image_size:
        resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
        canvas = canvas.resize((image_size, image_size), resampling)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)

    final_area_ratio = ((right - left) * (bottom - top)) / max(1, original_width * original_height)

    return {
        "enabled": True,
        "inputPath": str(input_path),
        "outputPath": str(output_path),
        "originalSize": [original_width, original_height],
        "processedSize": list(canvas.size),
        "threshold": threshold,
        "cropPadding": crop_padding,
        "segmentationMethodRequested": segmentation_method,
        "segmentationMethodUsed": mask_diagnostics.get("method", segmentation_method),
        "rawBbox": list(raw_bbox) if raw_bbox else None,
        "bbox": [left, top, right, bottom],
        "bboxAreaRatio": round(final_area_ratio, 6),
        "usedCenterCrop": used_center_crop,
        "usedMaskBbox": used_mask_bbox,
        "maskDiagnostics": mask_diagnostics,
    }


def texture_file_candidates(obj_path: Path) -> Dict[str, str]:
    stem = str(obj_path.with_suffix(""))
    candidates = {
        "albedo": [f"{stem}.jpg", f"{stem}.png", f"{stem}_albedo.jpg", f"{stem}_albedo.png"],
        "metallic": [f"{stem}_metallic.jpg", f"{stem}_metallic.png", f"{stem}_mr.jpg", f"{stem}_mr.png"],
        "roughness": [f"{stem}_roughness.jpg", f"{stem}_roughness.png", f"{stem}_mr.jpg", f"{stem}_mr.png"],
        "normal": [f"{stem}_normal.jpg", f"{stem}_normal.png"],
    }

    result: Dict[str, str] = {}

    for key, paths in candidates.items():
        for value in paths:
            if Path(value).exists():
                result[key] = value
                break

    return result


def paint_texture_mesh(
    mesh_path: Path,
    image_path: Path,
    output_glb_path: Path,
    max_num_view: int,
    resolution: int,
    use_remesh: bool,
) -> Dict[str, Any]:
    if not mesh_path.exists():
        fail(f"Texture input mesh does not exist: {mesh_path}")

    if not image_path.exists():
        fail(f"Texture source image does not exist: {image_path}")

    if not HY3D_PAINT_ROOT.exists():
        fail(f"HY3D paint root does not exist: {HY3D_PAINT_ROOT}")

    prepare_hy3d_paths()

    try:
        from utils.torchvision_fix import apply_fix
        apply_fix()
    except Exception as exc:
        print(f"[hy3dpaint] torchvision compatibility fix skipped: {type(exc).__name__}: {exc}", flush=True)

    try:
        from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline
        from hy3dpaint.convert_utils import create_glb_with_pbr_materials

        inpaint_patch = disable_missing_mesh_inpaint()
    except Exception as exc:
        fail(f"Failed to import Hunyuan3D Paint pipeline: {type(exc).__name__}: {exc}")

    output_glb_path = output_glb_path.resolve()
    output_glb_path.parent.mkdir(parents=True, exist_ok=True)

    output_obj_path = output_glb_path.with_suffix(".obj")
    started = time.time()

    print(f"[hy3dpaint] input mesh: {mesh_path}", flush=True)
    print(f"[hy3dpaint] source image: {image_path}", flush=True)
    print(f"[hy3dpaint] output obj: {output_obj_path}", flush=True)
    print(f"[hy3dpaint] output glb: {output_glb_path}", flush=True)

    try:
        conf = Hunyuan3DPaintConfig(max_num_view=max_num_view, resolution=resolution)
        conf.realesrgan_ckpt_path = "hy3dpaint/ckpt/RealESRGAN_x4plus.pth"
        conf.multiview_cfg_path = "hy3dpaint/cfgs/hunyuan-paint-pbr.yaml"
        conf.custom_pipeline = "hy3dpaint/hunyuanpaintpbr/pipeline.py"

        paint_device = os.environ.get("HY3D_PAINT_DEVICE", "").strip()
        if paint_device:
            conf.device = paint_device

        paint_pipeline = Hunyuan3DPaintPipeline(conf)

        textured_obj_path = paint_pipeline(
            mesh_path=str(mesh_path),
            image_path=str(image_path),
            output_mesh_path=str(output_obj_path),
            use_remesh=use_remesh,
            save_glb=False,
        )

        textured_obj = Path(textured_obj_path).resolve()

        if not textured_obj.exists():
            fail(f"Hunyuan3D Paint did not create textured OBJ: {textured_obj}")

        textures = texture_file_candidates(textured_obj)

        if "albedo" not in textures:
            fail(
                "Hunyuan3D Paint did not create an albedo texture next to the textured OBJ. "
                f"Checked stem: {textured_obj.with_suffix('')}"
            )

        create_glb_with_pbr_materials(str(textured_obj), textures, str(output_glb_path))

        if not output_glb_path.exists() or output_glb_path.stat().st_size <= 0:
            fail(f"Textured GLB was not created or is empty: {output_glb_path}")

        elapsed = round(time.time() - started, 2)

        return {
            "ok": True,
            "engine": "Hunyuan3D-Paint-2.1",
            "meshPath": str(mesh_path),
            "imagePath": str(image_path),
            "outputObjPath": str(textured_obj),
            "outputGlbPath": str(output_glb_path),
            "bytes": output_glb_path.stat().st_size,
            "elapsedSeconds": elapsed,
            "maxNumView": max_num_view,
            "resolution": resolution,
            "useRemesh": use_remesh,
            "textures": textures,
            "device": getattr(conf, "device", ""),
            "inpaintPatch": inpaint_patch,
        }
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"Hunyuan3D Paint failed: {type(exc).__name__}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a Hunyuan3D shape GLB from a character image.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--character-id", required=True, help="Character ID / slug.")
    parser.add_argument("--output", default="", help="Output GLB path. Optional.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HY3D model name or local path.")
    parser.add_argument("--guidance-scale", type=float, default=None, help="Optional guidance scale.")
    parser.add_argument("--preprocess-input", action="store_true", help="Crop, mask, square-pad, and resize the input before HY3D generation.")
    parser.add_argument("--preprocess-output", default="", help="Path for the preprocessed HY3D input PNG.")
    parser.add_argument("--preprocess-only", action="store_true", help="Write the preprocessed input image and exit without running HY3D.")
    parser.add_argument("--background-threshold", type=int, default=28, help="Foreground mask threshold for PIL fallback.")
    parser.add_argument("--crop-padding", type=float, default=0.14, help="Fractional padding around detected subject crop.")
    parser.add_argument("--image-size", type=int, default=1024, help="Square preprocessed image size in pixels.")
    parser.add_argument("--segmentation-method", choices=["grabcut", "pil", "center", "rembg"], default="grabcut", help="Preprocessing segmentation strategy.")

    parser.add_argument("--texture-only", action="store_true", help="Run only Hunyuan3D Paint on an existing mesh.")
    parser.add_argument("--paint-texture", action="store_true", help="Run Hunyuan3D Paint after shape generation.")
    parser.add_argument("--texture-input-mesh", default="", help="Existing mesh path for --texture-only.")
    parser.add_argument("--texture-image", default="", help="Source image path for texture generation. Defaults to --input.")
    parser.add_argument("--texture-output", default="", help="Output textured GLB path.")
    parser.add_argument("--paint-max-views", type=int, default=6, help="Paint pipeline selected view count.")
    parser.add_argument("--paint-resolution", type=int, default=512, help="Paint pipeline image resolution.")
    parser.add_argument("--no-paint-remesh", action="store_true", help="Disable paint pipeline remeshing.")

    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        fail(f"Input image does not exist: {input_path}")

    if not HY3D_SHAPE_ROOT.exists():
        fail(f"HY3D shape root does not exist: {HY3D_SHAPE_ROOT}")

    character_id = clean_character_id(args.character_id)
    if not character_id:
        fail("Invalid character ID.")

    if args.output:
        output_path = Path(args.output).resolve()
    else:
        output_path = Path(r"C:\AI\OTG-Test2\data\characters\web_characters_builder") / character_id / "models" / "hy3d_preview.glb"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.texture_only:
        texture_input_mesh = Path(args.texture_input_mesh or args.output).resolve()
        texture_image = Path(args.texture_image or args.input).resolve()
        texture_output = Path(args.texture_output or output_path.with_name("hy3d_preview_textured.glb")).resolve()

        payload = paint_texture_mesh(
            mesh_path=texture_input_mesh,
            image_path=texture_image,
            output_glb_path=texture_output,
            max_num_view=max(4, min(int(args.paint_max_views), 9)),
            resolution=max(256, int(args.paint_resolution)),
            use_remesh=not args.no_paint_remesh,
        )
        print(json.dumps(payload, indent=2))
        return

    preprocessing: Dict[str, Any] = {
        "enabled": False,
        "inputPath": str(input_path),
        "outputPath": "",
    }

    generation_input_path = input_path

    if args.preprocess_input or args.preprocess_only:
        if args.preprocess_output:
            preprocessed_path = Path(args.preprocess_output).resolve()
        else:
            preprocessed_path = output_path.parent / "hy3d_input_preprocessed.png"

        preprocessing = preprocess_character_image(
            input_path=input_path,
            output_path=preprocessed_path,
            image_size=max(256, int(args.image_size)),
            threshold=clamp(int(args.background_threshold), 1, 255),
            crop_padding=max(0.0, min(float(args.crop_padding), 0.5)),
            segmentation_method=args.segmentation_method,
        )
        generation_input_path = preprocessed_path
        print(f"[hy3d] preprocessed input: {generation_input_path}", flush=True)

    if args.preprocess_only:
        payload = {
            "ok": True,
            "engine": "Hunyuan3D-2.1",
            "characterId": character_id,
            "inputPath": str(input_path),
            "generationInputPath": str(generation_input_path),
            "outputPath": str(output_path),
            "preprocessing": preprocessing,
            "preprocessOnly": True,
        }
        print(json.dumps(payload, indent=2))
        return

    prepare_hy3d_paths()

    started = time.time()

    try:
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
    except Exception as exc:
        fail(f"Failed to import hy3dshape pipeline: {type(exc).__name__}: {exc}")

    try:
        print(f"[hy3d] loading model: {args.model}", flush=True)
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(args.model)

        print(f"[hy3d] generating mesh from: {generation_input_path}", flush=True)
        if args.guidance_scale is None:
            result = pipeline(image=str(generation_input_path))
        else:
            result = pipeline(image=str(generation_input_path), guidance_scale=args.guidance_scale)

        if not result:
            fail("HY3D pipeline returned no mesh.")

        mesh = result[0]
        temp_output = output_path.with_suffix(".tmp.glb")

        print(f"[hy3d] exporting: {temp_output}", flush=True)
        mesh.export(str(temp_output))

        if not temp_output.exists() or temp_output.stat().st_size <= 0:
            fail(f"HY3D export failed or produced empty file: {temp_output}")

        shutil.move(str(temp_output), str(output_path))

        texture_payload: Dict[str, Any] = {
            "enabled": False,
        }

        if args.paint_texture:
            texture_output = Path(args.texture_output or output_path.with_name("hy3d_preview_textured.glb")).resolve()
            texture_image = Path(args.texture_image or args.input).resolve()
            texture_payload = paint_texture_mesh(
                mesh_path=output_path,
                image_path=texture_image,
                output_glb_path=texture_output,
                max_num_view=max(4, min(int(args.paint_max_views), 9)),
                resolution=max(256, int(args.paint_resolution)),
                use_remesh=not args.no_paint_remesh,
            )

        elapsed = round(time.time() - started, 2)
        payload = {
            "ok": True,
            "engine": "Hunyuan3D-2.1",
            "inputPath": str(input_path),
            "generationInputPath": str(generation_input_path),
            "characterId": character_id,
            "outputPath": str(output_path),
            "bytes": output_path.stat().st_size,
            "elapsedSeconds": elapsed,
            "preprocessing": preprocessing,
            "texture": texture_payload,
        }
        print(json.dumps(payload, indent=2))
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"HY3D generation failed: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
