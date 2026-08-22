[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repositoryRoot "pets\furina--lingxiaotian"
$petRoot = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".codex\pets"
$destination = Join-Path $petRoot "furina--lingxiaotian"

foreach ($requiredFile in @("pet.json", "spritesheet.webp")) {
  $requiredPath = Join-Path $source $requiredFile
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Missing Furina pet file: $requiredPath"
  }
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source "pet.json") -Destination (Join-Path $destination "pet.json") -Force
Copy-Item -LiteralPath (Join-Path $source "spritesheet.webp") -Destination (Join-Path $destination "spritesheet.webp") -Force

Write-Host "Furina pet installed at $destination"
Write-Host "Open OpenPets > Control Center > Pets > Codex, then import 芙宁娜 and set her as default."
