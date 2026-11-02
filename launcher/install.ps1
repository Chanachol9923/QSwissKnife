# Creates QSwiftKnife shortcuts (with icon) on the Desktop and in the Start Menu.
#   npm run shortcut
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $PSScriptRoot 'QSwiftKnife.vbs'
$icon = Join-Path $PSScriptRoot 'qswiftknife.ico'

$exe = Join-Path $PSScriptRoot 'bin\QSwiftKnife.exe'

function New-Shortcut([string]$Path, [string]$Arguments, [string]$Description, [string]$Target = $wscript) {
  $s = $Shell.CreateShortcut($Path)
  $s.TargetPath = $Target
  $s.Arguments = $Arguments
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$icon,0"
  $s.Description = $Description
  $s.Save()
  Write-Host "  $Path"
}

$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')

Write-Host 'Created:'
# Prefer the native window (own taskbar identity); fall back to the browser-window launcher.
$app = if (Test-Path $exe) { @{ Target = $exe; Args = '' } } else { @{ Target = $wscript; Args = "`"$vbs`"" } }
New-Shortcut (Join-Path $desktop 'QSwiftKnife.lnk') $app.Args 'Convert, compress, crop and trim files' $app.Target
New-Shortcut (Join-Path $programs 'QSwiftKnife.lnk') $app.Args 'Convert, compress, crop and trim files' $app.Target
New-Shortcut (Join-Path $programs 'Stop QSwiftKnife server.lnk') "`"$vbs`" stop" 'Shut down the QSwiftKnife background server'
Write-Host ''
Write-Host 'To pin: right-click the QSwiftKnife shortcut on the Desktop (or in the Start Menu) and choose "Pin to taskbar".'
