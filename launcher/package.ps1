# Builds the installer:  release\QSwissKnife-Setup-<version>.exe
#   npm run package
#
# The installed app is self-contained - window exe + WebView2 DLLs, a bundled Node.js, the
# standalone server (server/serve.ts -> serve.mjs) and the built web app - so end users need
# nothing else. Uses only tools already on this machine: Node/npm, csc.exe from .NET Framework 4.8.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Here = $PSScriptRoot
$Stage = Join-Path $Root '.build\stage'
$Out = Join-Path $Root 'release'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fw = Split-Path $csc
$version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
Set-Location $Root

function Step([string]$m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed ($LASTEXITCODE)" } }

Step "QSwissKnife $version"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage, $Out, "$Stage\server", "$Stage\node" | Out-Null

Step 'Web app'
Run 'npx' @('vite', 'build')
Copy-Item -Recurse (Join-Path $Root 'dist') (Join-Path $Stage 'app')

Step 'Standalone server'
Run 'npx' @('esbuild', 'server/serve.ts', '--bundle', '--platform=node', '--format=esm', '--target=node20', '--minify', "--outfile=$Stage\server\serve.mjs")

Step 'Window app (QSwissKnife.exe)'
& (Join-Path $Here 'build-exe.ps1') -NoShortcuts
Copy-Item (Join-Path $Here 'bin\*') $Stage
Copy-Item (Join-Path $Here 'qswissknife.ico') $Stage

Step 'Uninstaller'
$refs = @("/reference:$fw\System.Windows.Forms.dll", "/reference:$fw\System.Drawing.dll", "/reference:$fw\System.IO.Compression.dll", "/reference:$fw\System.IO.Compression.FileSystem.dll")
Run $csc (@('/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+', "/out:$Stage\uninstall.exe", "/win32icon:$Here\qswissknife.ico") + $refs + @("$Here\Setup.cs"))

Step 'Node.js runtime'
$node = (Get-Command node).Source
$sig = Get-AuthenticodeSignature $node
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw "node.exe at $node isn't the official signed build." }
Copy-Item $node "$Stage\node\node.exe"
Set-Content "$Stage\node\NOTICE.txt" "Node.js $(& node -v) - https://nodejs.org`r`nCopyright OpenJS Foundation and Node.js contributors. Licensed under the MIT license: https://github.com/nodejs/node/blob/main/LICENSE" -Encoding UTF8

Step 'Payload'
$payload = Join-Path $Root '.build\payload.zip'
if (Test-Path $payload) { Remove-Item $payload }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($Stage, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host ("payload: {0:N1} MB" -f ((Get-Item $payload).Length / 1MB))

Step 'Setup'
$setup = Join-Path $Out "QSwissKnife-Setup-$version.exe"
Run $csc (@('/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+', "/out:$setup", "/win32icon:$Here\qswissknife.ico",
  "/resource:$payload,payload.zip", "/resource:$Here\qswissknife.ico,icon.ico", "/resource:$Root\public\icon-192.png,logo.png") + $refs + @("$Here\Setup.cs"))
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
Set-Content "$setup.sha256" "$hash  $(Split-Path $setup -Leaf)" -Encoding ASCII
Write-Host ("`nBuilt {0}  ({1:N1} MB)`nSHA256 {2}" -f $setup, ((Get-Item $setup).Length / 1MB), $hash) -ForegroundColor Green
