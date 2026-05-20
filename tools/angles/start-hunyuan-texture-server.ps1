$ErrorActionPreference = "Stop"

$HunyuanRoot = "C:\AI\Hunyuan3D"
$HunyuanApp = "C:\AI\Hunyuan3D\Hunyuan3D-2"
$Python = "C:\AI\Hunyuan3D\python_standalone\python.exe"
$CudaHome = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9"
$TorchLib = "C:\AI\Hunyuan3D\python_standalone\Lib\site-packages\torch\lib"

$env:CUDA_HOME = $CudaHome
$env:PATH = "$CudaHome\bin;$CudaHome\libnvvp;$TorchLib;$env:PATH"
$env:TORCH_CUDA_ARCH_LIST = "8.6"
$env:NVCC_PREPEND_FLAGS = "-allow-unsupported-compiler"
$env:DISTUTILS_USE_SDK = "1"
$env:MSSdk = "1"

Write-Host "[hunyuan] Verifying CUDA/Torch/custom_rasterizer..."
Push-Location $HunyuanRoot
& $Python -c "import torch; print('torch', torch.__version__, 'cuda', torch.version.cuda); import custom_rasterizer_kernel; import custom_rasterizer; print('custom_rasterizer OK')"
Pop-Location

Write-Host "[hunyuan] Starting textured Hunyuan server on 8080..."
Push-Location $HunyuanApp
& $Python -s gradio_app.py --mini --enable_t23d --profile 5 --turbo
Pop-Location
