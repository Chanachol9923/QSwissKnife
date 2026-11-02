# Builds launcher\bin\QSwiftKnife.exe (WebView2 window) and refreshes the shortcuts.
#   npm run app:build
# Needs only what ships with Windows 10/11: .NET Framework 4.8 (csc.exe) and the WebView2 runtime.
# The WebView2 SDK DLLs are fetched once from Microsoft's official NuGet package and signature-checked.
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Bin = Join-Path $Here 'bin'
$Sdk = Join-Path $Here 'webview2-sdk'
$Version = '1.0.4258.31'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $csc)) { throw '.NET Framework 4.x compiler (csc.exe) not found.' }

# 1. WebView2 SDK (managed wrappers + native loader)
$core = Join-Path $Sdk 'Microsoft.Web.WebView2.Core.dll'
if (-not (Test-Path $core)) {
  Write-Host "Fetching Microsoft.Web.WebView2 $Version from nuget.org..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "qsk-webview2-$Version"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $pkg = Join-Path $tmp 'pkg.zip'
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg" -OutFile $pkg
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($pkg)
  New-Item -ItemType Directory -Force $Sdk | Out-Null
  try {
    $want = @{
      'Microsoft.Web.WebView2.Core.dll'     = '^lib/net4[0-9]+/Microsoft\.Web\.WebView2\.Core\.dll$'
      'Microsoft.Web.WebView2.WinForms.dll' = '^lib/net4[0-9]+/Microsoft\.Web\.WebView2\.WinForms\.dll$'
      'WebView2Loader.dll'                  = '^runtimes/win-x64/native/WebView2Loader\.dll$'
    }
    foreach ($name in $want.Keys) {
      $entry = $zip.Entries | Where-Object { $_.FullName -match $want[$name] } | Select-Object -First 1
      if (-not $entry) { throw "Package is missing $name" }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Sdk $name), $true)
    }
  } finally { $zip.Dispose() }
  Remove-Item -Recurse -Force $tmp
  foreach ($f in Get-ChildItem $Sdk -Filter *.dll) {
    $sig = Get-AuthenticodeSignature $f.FullName
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
      Remove-Item -Recurse -Force $Sdk
      throw "$($f.Name) is not validly signed by Microsoft ($($sig.Status)). Aborting."
    }
  }
  Write-Host 'SDK verified (signed by Microsoft Corporation).'
}

# 2. Compile
New-Item -ItemType Directory -Force $Bin | Out-Null
# the exe and its DLLs are locked while running
$running = Get-Process QSwiftKnife -ErrorAction SilentlyContinue
if ($running) { $running | Stop-Process -Force; $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }
foreach ($dll in Get-ChildItem $Sdk -Filter *.dll) {
  $dest = Join-Path $Bin $dll.Name
  if (-not (Test-Path $dest) -or (Get-Item $dest).Length -ne $dll.Length) { Copy-Item $dll.FullName $dest -Force }
}
$fw = Split-Path $csc
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
  "/out:$(Join-Path $Bin 'QSwiftKnife.exe')" `
  "/win32icon:$(Join-Path $Here 'qswiftknife.ico')" `
  "/reference:$(Join-Path $Bin 'Microsoft.Web.WebView2.Core.dll')" `
  "/reference:$(Join-Path $Bin 'Microsoft.Web.WebView2.WinForms.dll')" `
  "/reference:$fw\System.Windows.Forms.dll" "/reference:$fw\System.Drawing.dll" `
  (Join-Path $Here 'QSwiftKnife.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compiling QSwiftKnife.exe failed.' }
Write-Host "Built $(Join-Path $Bin 'QSwiftKnife.exe')"

# 3. Shortcuts now point at the exe
& (Join-Path $Here 'install.ps1')
