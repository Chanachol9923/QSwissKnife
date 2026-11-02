# Opens QSwiftKnife in its own app window, starting the local server first if needed.
#   -Stop         shut the background server down instead
#   -ServerOnly   just make sure the server is running (used by QSwiftKnife.exe)
#   -ErrorFile    with -ServerOnly: write the failure message here instead of showing a dialog
param([switch]$Stop, [switch]$ServerOnly, [string]$ErrorFile)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Port = 4317
$Url = "http://127.0.0.1:$Port/"
$Log = Join-Path $PSScriptRoot 'server.log'

function Show-Error([string]$Message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, 'QSwiftKnife', 'OK', 'Error') | Out-Null
}

function Get-ServerPid {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $c.OwningProcess } else { $null }
}

function Test-Server {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$($Url)api/yt/health").StatusCode -eq 200 } catch { $false }
}

if ($Stop) {
  $serverPid = Get-ServerPid
  if ($serverPid) { Stop-Process -Id $serverPid -Force }
  exit 0
}

try {
  if (-not (Test-Server)) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw 'Node.js was not found. Install it from https://nodejs.org and try again.' }
    $vite = Join-Path $Root 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path $vite)) { throw "Dependencies are missing. Run 'npm install' in $Root first." }

    # Rebuild when anything that ends up in the app is newer than the last build.
    $dist = Join-Path $Root 'dist\index.html'
    $sources = @('src', 'public', 'server') | ForEach-Object { Get-ChildItem (Join-Path $Root $_) -Recurse -File }
    $sources += Get-Item (Join-Path $Root 'index.html'), (Join-Path $Root 'vite.config.ts')
    $newest = ($sources | Measure-Object LastWriteTimeUtc -Maximum).Maximum
    if (-not (Test-Path $dist) -or (Get-Item $dist).LastWriteTimeUtc -lt $newest) {
      $build = Start-Process -FilePath $node -ArgumentList "`"$vite`"", 'build' -WorkingDirectory $Root -WindowStyle Hidden -Wait -PassThru `
        -RedirectStandardOutput "$Log.build" -RedirectStandardError "$Log.build.err"
      if ($build.ExitCode -ne 0) { throw "Building QSwiftKnife failed. See $Log.build.err" }
    }

    # Port taken by something that isn't QSwiftKnife?
    if (Get-ServerPid) { throw "Port $Port is already in use by another program." }

    Start-Process -FilePath $node -ArgumentList "`"$vite`"", 'preview', '--port', $Port, '--strictPort', '--host', '127.0.0.1' `
      -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"

    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Server)) {
      if ((Get-Date) -gt $deadline) { throw "The QSwiftKnife server didn't start. See $Log.err" }
      Start-Sleep -Milliseconds 300
    }
  }

  if ($ServerOnly) { exit 0 }

  # Fallback when QSwiftKnife.exe isn't built: an app-style browser window (no tabs or address bar).
  $browsers = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($browser) { Start-Process $browser -ArgumentList "--app=$Url", '--window-size=1320,880' }
  else { Start-Process $Url }
}
catch {
  if ($ServerOnly -and $ErrorFile) { Set-Content -Path $ErrorFile -Value $_.Exception.Message -Encoding UTF8 } else { Show-Error $_.Exception.Message }
  exit 1
}
