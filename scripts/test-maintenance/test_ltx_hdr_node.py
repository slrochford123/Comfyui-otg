"""TEST-only HDR export bridge around the installed official Lightricks nodes.

OpenImageIO is isolated under a deployment-configured dependency directory, not
installed into the shared Comfy venv. No shell command or output root is exposed.
"""
import re
import os
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

DEPENDENCIES = os.environ.get("OTG_LTX_HDR_DEPENDENCIES", "/opt/slr-studios/dependencies/ltx-hdr")

class TESTLTXHDRExport:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required":{"image":("IMAGE",),"frame_rate":("FLOAT",{"default":24.0,"min":1,"max":60}),"filename_prefix":("STRING",)},"optional":{"audio":("AUDIO",)}}
    RETURN_TYPES=("IMAGE",)
    FUNCTION="export"
    OUTPUT_NODE=True
    CATEGORY="SLR TEST/LTX"

    def export(self,image,frame_rate,filename_prefix,audio=None):
        if not re.fullmatch(r"EditVideo/LTX_Edit_[0-9a-f-]{36}",filename_prefix):
            raise ValueError("Invalid TEST HDR job prefix")
        import folder_paths
        import nodes
        # Only this explicitly invoked TEST node uses the isolated wheel.
        sys.path.insert(0,DEPENDENCIES)
        try:
            import OpenImageIO  # noqa: F401
            processor=nodes.NODE_CLASS_MAPPINGS["LTXVHDRDecodePostprocess"]()
            preview,hdr=processor.postprocess(image,transfer="acescct",save_exr=True,exr_color_space="acescg",output_dir=filename_prefix+"_exr",filename_prefix="frame",half_precision=True)
        finally:
            sys.path.remove(DEPENDENCIES)
        nodes.NODE_CLASS_MAPPINGS["LTXVSaveHLG"]().save(hdr,frame_rate,filename_prefix+"_master",linear_primaries="acescg",audio=audio)
        root=Path(folder_paths.get_output_directory()).resolve()
        prefix=root/filename_prefix
        masters=sorted(prefix.parent.glob(prefix.name+"_master_*_hlg.mp4"))
        if len(masters)!=1:raise RuntimeError("Expected one HDR master for this unique TEST job")
        frames=sorted((root/(filename_prefix+"_exr")).glob("frame_*.exr"))
        if not frames or any(frame.stat().st_size==0 for frame in frames):raise RuntimeError("EXR export incomplete")
        archive=prefix.with_name(prefix.name+"_acescg_exr.zip")
        with ZipFile(archive,"w",ZIP_STORED) as output:
            for frame in frames:output.write(frame,frame.name)
        def record(file):return {"filename":file.name,"subfolder":str(file.parent.relative_to(root)),"type":"output"}
        return {"ui":{"files":[record(masters[0]),record(archive)]},"result":(preview,)}

NODE_CLASS_MAPPINGS={"TESTLTXHDRExport":TESTLTXHDRExport}
