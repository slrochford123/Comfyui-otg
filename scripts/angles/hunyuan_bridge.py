import argparse
import contextlib
import json
import os
import sys
import traceback


def emit(payload: dict, exit_code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    raise SystemExit(exit_code)


def main() -> None:
    parser = argparse.ArgumentParser(description="OTG Hunyuan local bridge")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output_dir", required=True, help="Directory to write outputs into")
    parser.add_argument("--device", default="cuda", help="cuda or cpu")
    parser.add_argument("--low_vram", default="1", help="1=true, 0=false")
    parser.add_argument("--shape_model", default="tencent/Hunyuan3D-2mini")
    parser.add_argument("--shape_subfolder", default="hunyuan3d-dit-v2-mini")
    parser.add_argument("--texture_model", default="tencent/Hunyuan3D-2")
    parser.add_argument("--texture", default="true", help="true/false")
    args = parser.parse_args()

    try:
        from PIL import Image
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        os.makedirs(args.output_dir, exist_ok=True)

        if not os.path.isfile(args.input):
            emit(
                {
                    "ok": False,
                    "error": f"Input image not found: {args.input}",
                    "stage": "input",
                },
                exit_code=1,
            )

        input_image = Image.open(args.input).convert("RGB")

        with contextlib.redirect_stdout(sys.stderr):
            shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                args.shape_model,
                subfolder=args.shape_subfolder,
            )

            if args.device.lower() == "cuda":
                shape_pipe.to("cuda")
            elif args.device.lower() == "cpu":
                shape_pipe.to("cpu")

            shape_result = shape_pipe(input_image)

            # Hunyuan may return a mesh directly or a list/tuple wrapper.
            if isinstance(shape_result, (list, tuple)):
                if not shape_result:
                    emit(
                        {
                            "ok": False,
                            "error": "Shape pipeline returned an empty list.",
                            "stage": "shape_result",
                        },
                        exit_code=1,
                    )
                mesh = shape_result[0]
            else:
                mesh = shape_result

            if not hasattr(mesh, "export"):
                emit(
                    {
                        "ok": False,
                        "error": f"Shape result is not exportable. Got type: {type(mesh).__name__}",
                        "stage": "shape_result",
                    },
                    exit_code=1,
                )

            shape_path = os.path.join(args.output_dir, "shape.glb")
            mesh.export(shape_path)

            final_path = shape_path
            texture_failed = False
            texture_error = None

            if str(args.texture).lower() == "true":
                try:
                    tex_pipe = Hunyuan3DPaintPipeline.from_pretrained(args.texture_model)

                    if args.device.lower() == "cuda":
                        tex_pipe.to("cuda")
                    elif args.device.lower() == "cpu":
                        tex_pipe.to("cpu")

                    textured_result = tex_pipe(mesh, input_image)

                    if isinstance(textured_result, (list, tuple)):
                        if not textured_result:
                            raise RuntimeError("Texture pipeline returned an empty list.")
                        textured_mesh = textured_result[0]
                    else:
                        textured_mesh = textured_result

                    if not hasattr(textured_mesh, "export"):
                        raise RuntimeError(
                            f"Texture result is not exportable. Got type: {type(textured_mesh).__name__}"
                        )

                    textured_path = os.path.join(args.output_dir, "textured.glb")
                    textured_mesh.export(textured_path)
                    final_path = textured_path

                except Exception as tex_err:
                    texture_failed = True
                    texture_error = str(tex_err)

        emit(
            {
                "ok": True,
                "model_path": final_path,
                "shape_path": shape_path,
                "texture_failed": texture_failed,
                "texture_error": texture_error,
            }
        )

    except Exception as exc:
        emit(
            {
                "ok": False,
                "error": str(exc),
                "stage": "bridge",
                "trace": traceback.format_exc(),
            },
            exit_code=1,
        )


if __name__ == "__main__":
    main()