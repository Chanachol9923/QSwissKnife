# Creates QSwissKnife shortcuts (with icon) on the Desktop and in the Start Menu.
#   npm run shortcut
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $PSScriptRoot 'QSwissKnife.vbs'
$icon = Join-Path $PSScriptRoot 'qswissknife.ico'

$exe = Join-Path $PSScriptRoot 'bin\QSwissKnife.exe'

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
New-Shortcut (Join-Path $desktop 'QSwissKnife.lnk') $app.Args 'Convert, compress, crop and trim files' $app.Target
New-Shortcut (Join-Path $programs 'QSwissKnife.lnk') $app.Args 'Convert, compress, crop and trim files' $app.Target
New-Shortcut (Join-Path $programs 'Stop QSwissKnife server.lnk') "`"$vbs`" stop" 'Shut down the QSwissKnife background server'
Write-Host ''
Write-Host 'To pin: right-click the QSwissKnife shortcut on the Desktop (or in the Start Menu) and choose "Pin to taskbar".'
