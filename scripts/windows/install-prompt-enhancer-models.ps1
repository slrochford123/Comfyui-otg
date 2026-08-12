param(
  [switch]$ShortOnly
)

$ErrorActionPreference = "Stop"

Write-Host "Installing local OTG prompt enhancer models through Ollama..."
Write-Host ""

$Ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (!$Ollama) {
  throw "Ollama was not found on PATH. Install Ollama first, then rerun this script."
}

ollama pull qwen2.5:0.5b

if (!$ShortOnly) {
  ollama pull qwen2.5:1.5b
}

Write-Host ""
Write-Host "Done."
Write-Host "Recommended env:"
Write-Host "OLLAMA_BASE_URL=http://127.0.0.1:11434"
Write-Host "OLLAMA_PROMPT_ENHANCE_MODEL_SHORT=qwen2.5:0.5b"
Write-Host "OLLAMA_PROMPT_ENHANCE_MODEL=qwen2.5:1.5b"
