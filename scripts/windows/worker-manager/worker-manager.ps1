param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "start", "stop", "restart")]
  [string]$Action = "status",

  [Parameter(Position = 1)]
  [string]$WorkerName = "all",

  [switch]$Json,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ManagerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ManagerRoot "workers.json"
$LogsDir = Join-Path $ManagerRoot "logs"
$RunDir = Join-Path $ManagerRoot "run"
$AuditLog = Join-Path $LogsDir "manager-audit.log"
$OwnedBy = "OTG-WorkerManager"

New-Item -ItemType Directory -Force -Path $LogsDir, $RunDir | Out-Null

function Mask-Secrets {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return $null }
  $masked = $Text -replace '(?i)(--worker-token\s+)\S+', '$1***MASKED***'
  $masked = $masked -replace '(?i)(Authorization:\s*Bearer\s+)\S+', '$1***MASKED***'
  $masked = $masked -replace '(?i)(Bearer\s+)\S+', '$1***MASKED***'
  $masked = $masked -replace '(?i)(OTG_WORKER_TOKEN=)[^ ;"]+', '$1MASKED'
  return $masked
}

function Write-Audit {
  param([string]$Event, [string]$WorkerId = "", [string]$Message = "")
  $line = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString("o")
    event = $Event
    workerId = $WorkerId
    message = (Mask-Secrets $Message)
  } | ConvertTo-Json -Compress
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Add-Content -LiteralPath $AuditLog -Value $line -Encoding UTF8
      return
    } catch {
      if ($attempt -eq 3) { return }
      Start-Sleep -Milliseconds (50 * $attempt)
    }
  }
}

function Read-Config {
  if (!(Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing workers.json: $ConfigPath"
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if (!$config.workers) { throw "workers.json does not contain workers." }
  return $config
}

function Get-Worker {
  param([string]$Id)
  $worker = (Read-Config).workers | Where-Object { $_.id -eq $Id } | Select-Object -First 1
  if (!$worker) { throw "Unknown worker: $Id" }
  return $worker
}

function Get-AllWorkers {
  return (Read-Config).workers
}

function Get-CommandHash {
  param($Worker)
  $canonical = [ordered]@{
    command = [string]$Worker.command
    args = @($Worker.args)
    workingDirectory = [string]$Worker.workingDirectory
  } | ConvertTo-Json -Compress -Depth 8
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
  return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
}

function Read-PidMetadata {
  param($Worker)
  $pidFile = [string]$Worker.pidFile
  if (!(Test-Path -LiteralPath $pidFile)) { return $null }
  try {
    return Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  } catch {
    Write-Audit "pid-read-failed" $Worker.id $_.Exception.Message
    return $null
  }
}

function Remove-PidFile {
  param($Worker)
  if (Test-Path -LiteralPath ([string]$Worker.pidFile)) {
    Remove-Item -LiteralPath ([string]$Worker.pidFile) -Force
  }
}

function Get-CimProcessById {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Find-UnmanagedMatchingProcess {
  param($Worker)
  $contains = @($Worker.health.commandLineContains)
  if ($contains.Count -eq 0) { return $null }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($process in $processes) {
    $cmd = [string]$process.CommandLine
    if (!$cmd) { continue }
    if ($cmd -match [regex]::Escape("worker-manager.ps1")) { continue }
    if ($cmd -match "Get-CimInstance|Where-Object|Select-Object") { continue }
    $ok = $true
    foreach ($item in $contains) {
      if ($cmd -notmatch [regex]::Escape([string]$item)) {
        $ok = $false
        break
      }
    }
    if ($ok) { return $process }
  }
  return $null
}

function Test-ExpectedProcess {
  param($Worker, $Metadata, $Process)
  if (!$Metadata -or !$Process) { return $false }
  if ([string]$Metadata.ownedBy -ne $OwnedBy) { return $false }
  if ([string]$Metadata.workerId -ne [string]$Worker.id) { return $false }
  if ([string]$Metadata.commandHash -ne (Get-CommandHash $Worker)) { return $false }

  $cmd = [string]$Process.CommandLine
  foreach ($item in @($Worker.health.commandLineContains)) {
    if ($cmd -notmatch [regex]::Escape([string]$item)) { return $false }
  }
  foreach ($item in @($Worker.health.commandLineMustNotContain)) {
    if ($cmd -match [regex]::Escape([string]$item)) { return $false }
  }
  return $true
}

function Get-ChildProcesses {
  param([int]$ParentProcessId)
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in @($children)) {
    $children += @(Get-ChildProcesses -ParentProcessId ([int]$child.ProcessId))
  }
  return $children
}

function Get-Health {
  param($Worker, $Process)
  if (!$Process) {
    return [ordered]@{
      ok = $false
      summary = "process not running"
      commandLineContainsOk = $false
      commandLineMustNotContainOk = $true
    }
  }

  $cmd = [string]$Process.CommandLine
  $contains = @($Worker.health.commandLineContains)
  $mustNot = @($Worker.health.commandLineMustNotContain)
  $containsOk = $true
  foreach ($item in $contains) {
    if ($cmd -notmatch [regex]::Escape([string]$item)) { $containsOk = $false }
  }
  $mustNotOk = $true
  foreach ($item in $mustNot) {
    if ($cmd -match [regex]::Escape([string]$item)) { $mustNotOk = $false }
  }

  return [ordered]@{
    ok = ($containsOk -and $mustNotOk)
    summary = if ($containsOk -and $mustNotOk) { "process command line matches expected worker and contains no forbidden token argument" } else { "process command line failed health policy" }
    commandLineContainsOk = $containsOk
    commandLineMustNotContainOk = $mustNotOk
  }
}

function Get-Status {
  param($Worker)
  $metadata = Read-PidMetadata $Worker
  $state = "stopped"
  $pidValue = $null
  $startedAt = $null
  $process = $null

  if ($metadata) {
    $pidValue = [int]$metadata.processId
    $startedAt = [string]$metadata.startedAt
    $process = Get-CimProcessById -ProcessId $pidValue
    if ($process) {
      if (Test-ExpectedProcess $Worker $metadata $process) {
        $state = "running"
      } else {
        $state = "unknown"
      }
    } else {
      $state = "stale-pid"
      Remove-PidFile $Worker
      Write-Audit "stale-pid-removed" $Worker.id "Removed stale PID file $($Worker.pidFile)"
    }
  } else {
    $unmanaged = Find-UnmanagedMatchingProcess $Worker
    if ($unmanaged) {
      $state = "unknown"
      $pidValue = [int]$unmanaged.ProcessId
      $process = $unmanaged
    }
  }

  return [ordered]@{
    workerId = [string]$Worker.id
    displayName = [string]$Worker.displayName
    enabled = [bool]$Worker.enabled
    dryRunOnly = [bool]$Worker.dryRunOnly
    dangerousStop = [bool]$Worker.dangerousStop
    resourceHints = @($Worker.resourceHints)
    lane = [string]$Worker.lane
    gpu = [string]$Worker.gpu
    userStatusKind = [string]$Worker.userStatusKind
    state = $state
    pid = $pidValue
    startedAt = $startedAt
    logPath = [string]$Worker.logPath
    pidFile = [string]$Worker.pidFile
    health = Get-Health $Worker $process
  }
}

function Assert-WorkerCanRun {
  param($Worker, [switch]$SkipRequiredEnv)
  if (-not [bool]$Worker.enabled) { throw "Worker is disabled: $($Worker.id)" }
  if (-not $SkipRequiredEnv) {
    foreach ($name in @($Worker.requiredEnv)) {
      if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable([string]$name, "Process"))) {
        throw "Missing required environment variable: $name"
      }
    }
  }
  if (!(Test-Path -LiteralPath ([string]$Worker.workingDirectory))) {
    throw "Working directory not found: $($Worker.workingDirectory)"
  }
}

function Start-Worker {
  param($Worker)
  Assert-WorkerCanRun $Worker -SkipRequiredEnv:$DryRun
  $args = @($Worker.args | ForEach-Object { [string]$_ })
  $commandText = "$($Worker.command) $($args -join ' ')"
  $status = Get-Status $Worker
  if ($DryRun) {
    Write-Audit "start-dry-run" $Worker.id $commandText
    return [ordered]@{
      workerId = [string]$Worker.id
      action = "start"
      dryRun = $true
      currentState = $status.state
      currentPid = $status.pid
      wouldRun = Mask-Secrets $commandText
      logPath = [string]$Worker.logPath
      pidFile = [string]$Worker.pidFile
    }
  }
  if ([bool]$Worker.dryRunOnly) {
    throw "Worker is marked dryRunOnly and cannot be started for real: $($Worker.id)"
  }
  if ($status.state -eq "running") {
    Write-Audit "start-skip-running" $Worker.id "Already running with PID $($status.pid)"
    return $status
  }
  if ($status.state -eq "unknown") {
    throw "Refusing to start: matching worker process exists but is not owned by $OwnedBy. PID: $($status.pid)"
  }

  foreach ($entry in $Worker.env.PSObject.Properties) {
    if ($entry.Name -eq "OTG_WORKER_TOKEN") {
      throw "workers.json must not contain OTG_WORKER_TOKEN."
    }
    [Environment]::SetEnvironmentVariable([string]$entry.Name, [string]$entry.Value, "Process")
  }

  $logPath = [string]$Worker.logPath
  $errorLogPath = "$logPath.err"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath), (Split-Path -Parent ([string]$Worker.pidFile)) | Out-Null
  Add-Content -LiteralPath $logPath -Value "`n===== OTG-WorkerManager start $(Get-Date -Format o) =====" -Encoding UTF8
  Add-Content -LiteralPath $errorLogPath -Value "`n===== OTG-WorkerManager stderr $(Get-Date -Format o) =====" -Encoding UTF8

  $process = Start-Process -FilePath ([string]$Worker.command) `
    -ArgumentList $args `
    -WorkingDirectory ([string]$Worker.workingDirectory) `
    -WindowStyle Hidden `
    -PassThru

  Start-Sleep -Milliseconds 500
  $cim = Get-CimProcessById -ProcessId ([int]$process.Id)
  $metadata = [ordered]@{
    workerId = [string]$Worker.id
    processId = [int]$process.Id
    parentProcessId = if ($cim) { [int]$cim.ParentProcessId } else { $null }
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    commandHash = Get-CommandHash $Worker
    workingDirectory = [string]$Worker.workingDirectory
    ownedBy = $OwnedBy
  }
  $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ([string]$Worker.pidFile) -Encoding UTF8
  Write-Audit "started" $Worker.id "Started PID $($process.Id)"
  return Get-Status $Worker
}

function Stop-Worker {
  param($Worker)
  $metadata = Read-PidMetadata $Worker
  if (!$metadata) {
    Write-Audit "stop-skip-no-pid" $Worker.id "No PID file."
    return Get-Status $Worker
  }
  if ([string]$metadata.ownedBy -ne $OwnedBy) {
    throw "Refusing to stop: PID file is not owned by $OwnedBy."
  }

  $process = Get-CimProcessById -ProcessId ([int]$metadata.processId)
  if (!$process) {
    Remove-PidFile $Worker
    Write-Audit "stop-stale-pid" $Worker.id "Process gone; removed stale PID file."
    return Get-Status $Worker
  }
  if (!(Test-ExpectedProcess $Worker $metadata $process)) {
    throw "Refusing to stop: process does not match expected worker command/hash."
  }

  $tree = @($process) + @(Get-ChildProcesses -ParentProcessId ([int]$process.ProcessId))
  $ids = @($tree | Sort-Object ProcessId -Descending | Select-Object -ExpandProperty ProcessId)
  if ($DryRun) {
    Write-Audit "stop-dry-run" $Worker.id "Would stop PIDs: $($ids -join ',')"
    return [ordered]@{
      workerId = [string]$Worker.id
      action = "stop"
      dryRun = $true
      wouldStopProcessIds = $ids
    }
  }
  if ([bool]$Worker.dryRunOnly) {
    throw "Worker is marked dryRunOnly and cannot be stopped for real: $($Worker.id)"
  }

  foreach ($id in $ids) {
    Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
  Remove-PidFile $Worker
  Write-Audit "stopped" $Worker.id "Stopped PIDs: $($ids -join ',')"
  return Get-Status $Worker
}

function Restart-Worker {
  param($Worker)
  $stop = Stop-Worker $Worker
  if ($DryRun) {
    $start = Start-Worker $Worker
    return [ordered]@{ workerId = [string]$Worker.id; action = "restart"; dryRun = $true; stop = $stop; start = $start }
  }
  Start-Sleep -Seconds 1
  return Start-Worker $Worker
}

function Write-Result {
  param($Value)
  if ($Json) {
    $Value | ConvertTo-Json -Depth 12
  } else {
    $Value | Format-List
  }
}

try {
  Write-Audit "invoke" $WorkerName "$Action dryRun=$DryRun json=$Json"
  if ($Action -eq "status" -and $WorkerName -eq "all") {
    Write-Result (@(Get-AllWorkers | ForEach-Object { Get-Status $_ }))
    exit 0
  }

  if ($WorkerName -eq "all") {
    throw "Action '$Action' requires a specific worker name."
  }

  $worker = Get-Worker $WorkerName
  $result = switch ($Action) {
    "status" { Get-Status $worker }
    "start" { Start-Worker $worker }
    "stop" { Stop-Worker $worker }
    "restart" { Restart-Worker $worker }
  }
  Write-Result $result
  exit 0
} catch {
  $message = Mask-Secrets $_.Exception.Message
  Write-Audit "error" $WorkerName $message
  if ($Json) {
    [ordered]@{ ok = $false; error = $message } | ConvertTo-Json -Depth 4
  } else {
    Write-Error $message
  }
  exit 1
}
