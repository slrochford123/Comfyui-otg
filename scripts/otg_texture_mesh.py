from __future__ import annotations

import argparse
import json
import math
import os
import sys
import traceback
from typing import List, Tuple

import bpy  # type: ignore
from mathutils import Vector  # type: ignore


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser(description="OTG mesh texturing worker for Blender")
    parser.add_argument("--input-glb", required=True)
    parser.add_argument("--input-image", required=True)
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--output-texture", default="")
    parser.add_argument("--texture-size", type=int, default=2048)
    parser.add_argument("--bake-margin", type=int, default=16)
    parser.add_argument("--front-view", default="")
    parser.add_argument("--front-right-45", default="")
    parser.add_argument("--right-90", default="")
    parser.add_argument("--back-right-135", default="")
    parser.add_argument("--back-view", default="")
    parser.add_argument("--back-left-135", default="")
    parser.add_argument("--left-90", default="")
    parser.add_argument("--front-left-45", default="")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(filepath: str) -> None:
    bpy.ops.import_scene.gltf(filepath=filepath)


def mesh_objects() -> list:
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def join_meshes(objs: list):
    if not objs:
        raise RuntimeError("No mesh objects were imported from the GLB.")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def ensure_uvs(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def world_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (min_v + max_v) * 0.5
    size = max_v - min_v
    return center, size


def create_projection_camera_yaw(center: Vector, size: Vector, yaw_deg: float, image_aspect: float):
    radius = max(size.x, size.y, size.z, 0.001)
    distance = max(radius * 2.8, 2.0)
    yaw = math.radians(yaw_deg)
    offset = Vector((math.sin(yaw) * distance, -math.cos(yaw) * distance, 0.0))

    cam_data = bpy.data.cameras.new(f"OTG_Projector_{int(yaw_deg)}")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(distance * 10.0, 100.0)

    cam_obj = bpy.data.objects.new(f"OTG_Projector_{int(yaw_deg)}", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = center + offset
    direction = center - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    safe_aspect = image_aspect if image_aspect > 0 else 1.0
    cam_data.ortho_scale = max(size.x, size.z * safe_aspect, size.y) * 1.2
    bpy.context.scene.camera = cam_obj
    return cam_obj


def configure_cycles() -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.preview_samples = 1
    scene.render.bake.margin = 16

    mode = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for candidate in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = candidate
                prefs.get_devices()
                devices = getattr(prefs, "devices", [])
                if devices:
                    for dev in devices:
                        dev.use = True
                    scene.cycles.device = "GPU"
                    mode = candidate
                    break
            except Exception:
                continue
    except Exception:
        mode = "CPU"
    return mode


def build_projection_material(source_image, bake_image):
    mat = bpy.data.materials.new("OTG_ProjectionMaterial")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (900, 0)

    emission = nodes.new("ShaderNodeEmission")
    emission.location = (700, 0)

    combine = nodes.new("ShaderNodeMixRGB")
    combine.blend_type = "MIX"
    combine.location = (500, 0)

    backfacing = nodes.new("ShaderNodeNewGeometry")
    backfacing.location = (100, 180)

    texcoord = nodes.new("ShaderNodeTexCoord")
    texcoord.location = (-360, 20)

    source_tex = nodes.new("ShaderNodeTexImage")
    source_tex.location = (-120, 120)
    source_tex.interpolation = "Linear"
    source_tex.image = source_image

    existing_tex = nodes.new("ShaderNodeTexImage")
    existing_tex.location = (-120, -120)
    existing_tex.interpolation = "Linear"
    existing_tex.image = bake_image

    bake_tex = nodes.new("ShaderNodeTexImage")
    bake_tex.location = (-120, -320)
    bake_tex.image = bake_image

    links.new(texcoord.outputs["Camera"], source_tex.inputs["Vector"])
    links.new(texcoord.outputs["UV"], existing_tex.inputs["Vector"])
    links.new(backfacing.outputs["Backfacing"], combine.inputs["Fac"])
    links.new(source_tex.outputs["Color"], combine.inputs[1])
    links.new(existing_tex.outputs["Color"], combine.inputs[2])
    links.new(combine.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], out.inputs["Surface"])

    mat.node_tree.nodes.active = bake_tex
    return mat, bake_tex


def build_final_material(bake_image):
    mat = bpy.data.materials.new("OTG_FinalTexturedMaterial")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (480, 0)

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (220, 0)
    try:
        bsdf.inputs["Roughness"].default_value = 0.7
    except Exception:
        pass

    tex = nodes.new("ShaderNodeTexImage")
    tex.location = (-40, 0)
    tex.interpolation = "Linear"
    tex.image = bake_image

    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Alpha" in tex.outputs and "Alpha" in bsdf.inputs:
        links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def assign_material(obj, material) -> None:
    if obj.data.materials:
        obj.data.materials[0] = material
        for idx in range(len(obj.data.materials) - 1, 0, -1):
            obj.data.materials.pop(index=idx)
    else:
        obj.data.materials.append(material)


def bake_projection(obj, bake_margin: int, clear_image: bool) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.scene.render.bake.margin = bake_margin
    bpy.ops.object.bake(type="EMIT", use_clear=clear_image, margin=bake_margin)


def export_glb(filepath: str) -> None:
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    try:
        bpy.ops.file.pack_all()
    except Exception:
        pass
    bpy.ops.export_scene.gltf(filepath=filepath, export_format="GLB")


def existing_file(path_value: str) -> str:
    p = str(path_value or "").strip()
    return p if p and os.path.exists(p) else ""


def ordered_views(args: argparse.Namespace) -> List[Tuple[str, float, str]]:
    views = [("front_view", 0.0, existing_file(args.front_view))]
    for name, yaw, candidate in [
        ("front_right_45", 45.0, args.front_right_45),
        ("right_90", 90.0, args.right_90),
        ("back_right_135", 135.0, args.back_right_135),
        ("back_view", 180.0, args.back_view),
        ("back_left_135", -135.0, args.back_left_135),
        ("left_90", -90.0, args.left_90),
        ("front_left_45", -45.0, args.front_left_45),
    ]:
        p = existing_file(candidate)
        if p:
            views.append((name, yaw, p))
    return views


def main() -> None:
    args = parse_args()
    clear_scene()
    import_glb(args.input_glb)

    objs = mesh_objects()
    model = join_meshes(objs)
    bpy.ops.object.select_all(action="DESELECT")
    model.select_set(True)
    bpy.context.view_layer.objects.active = model
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ensure_uvs(model)

    base_source_image = bpy.data.images.load(args.input_image)
    img_w = int(base_source_image.size[0] or 1)
    img_h = int(base_source_image.size[1] or 1)
    bpy.context.scene.render.resolution_x = img_w
    bpy.context.scene.render.resolution_y = img_h
    bpy.context.scene.render.resolution_percentage = 100

    center, size = world_bounds(model)
    texture_size = max(512, min(int(args.texture_size), 8192))
    bake_margin = max(0, min(int(args.bake_margin), 128))
    render_mode = configure_cycles()

    bake_image = bpy.data.images.new(
        "OTG_BakedTexture",
        width=texture_size,
        height=texture_size,
        alpha=True,
    )

    used_views: List[str] = []
    clear_image = True
    for view_name, yaw_deg, image_path in ordered_views(args):
        source_path = args.input_image if view_name == "front_view" else image_path
        if not source_path or not os.path.exists(source_path):
            continue
        source_image = base_source_image if source_path == args.input_image else bpy.data.images.load(source_path)
        view_w = int(source_image.size[0] or img_w or 1)
        view_h = int(source_image.size[1] or img_h or 1)
        image_aspect = float(view_w) / float(view_h or 1)
        create_projection_camera_yaw(center, size, yaw_deg, image_aspect)
        projection_material, _ = build_projection_material(source_image, bake_image)
        assign_material(model, projection_material)
        bake_projection(model, bake_margin, clear_image)
        clear_image = False
        used_views.append(view_name)

    if not used_views:
        raise RuntimeError("No usable texture source images were provided to Blender.")

    output_texture = args.output_texture or os.path.splitext(args.output_glb)[0] + "_texture.png"
    os.makedirs(os.path.dirname(output_texture), exist_ok=True)
    bake_image.filepath_raw = output_texture
    bake_image.file_format = "PNG"
    bake_image.save()

    final_material = build_final_material(bake_image)
    assign_material(model, final_material)
    export_glb(args.output_glb)

    print(
        json.dumps(
            {
                "ok": True,
                "output_glb": args.output_glb,
                "output_texture": output_texture,
                "render_mode": render_mode,
                "used_views": used_views,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        payload = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        print(json.dumps(payload))
        raise
