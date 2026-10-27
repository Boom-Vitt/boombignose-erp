# Add pinned Node and portable Postgres to an existing standalone server.
# The Next.js server is built once on Linux and must already be at
# dist/bundle/erp/server.js. This script does not run npm or next build,
# and it does not delete that server.
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$nodeVersion = "22.21.1"
$nodeSha = "3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
$pgSha = "8fbb986005ed7cfe486d6626a7859235a9713fadd164aff0b0a37ce1b65857d4"
$pgUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/16.10.0/embedded-postgres-binaries-windows-amd64-16.10.0.jar"
$pgInner = "postgres-windows-x86_64.txz"

$dist = Join-Path $root "dist\bundle"
$server = Join-Path $dist "erp\server.js"
if (-not (Test-Path -LiteralPath $server)) {
  throw "standalone server.js missing at $server"
}
if (Test-Path -LiteralPath (Join-Path $dist "node.exe")) {
  Remove-Item -LiteralPath (Join-Path $dist "node.exe") -Force
}
if (Test-Path -LiteralPath (Join-Path $dist "postgres")) {
  Remove-Item -LiteralPath (Join-Path $dist "postgres") -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$tmp = Join-Path $env:TEMP ("bbn-assemble-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  function Assert-Sha256([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower()
    if ($actual -ne $Expected) {
      throw "sha256 mismatch for ${Path}: $actual"
    }
  }

  $nodeZip = Join-Path $tmp "node.zip"
  curl.exe -fsSL -o $nodeZip $nodeUrl
  Assert-Sha256 $nodeZip $nodeSha
  $nodeExtract = Join-Path $tmp "node"
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract
  $nodeHome = Join-Path $nodeExtract "node-v$nodeVersion-win-x64"
  $nodeExe = Join-Path $nodeHome "node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Get-ChildItem -Recurse $nodeExtract | Select-Object -ExpandProperty FullName
    throw "node.exe missing in $nodeHome"
  }
  Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $dist "node.exe")
  Copy-Item -LiteralPath (Join-Path $nodeHome "LICENSE") -Destination (Join-Path $dist "NODE_LICENSE")

  $jar = Join-Path $tmp "pg.jar"
  curl.exe -fsSL -o $jar $pgUrl
  Assert-Sha256 $jar $pgSha
  $jarDir = Join-Path $tmp "jar"
  $jarZip = Join-Path $tmp "pg.zip"
  Copy-Item -LiteralPath $jar -Destination $jarZip
  Expand-Archive -LiteralPath $jarZip -DestinationPath $jarDir
  $txz = Join-Path $jarDir $pgInner
  if (-not (Test-Path -LiteralPath $txz)) {
    Get-ChildItem -Recurse $jarDir | Select-Object -ExpandProperty FullName
    throw "postgres archive missing from jar"
  }
  $pgRoot = Join-Path $dist "postgres"
  New-Item -ItemType Directory -Force -Path $pgRoot | Out-Null
  tar.exe -xJf $txz -C $pgRoot
  foreach ($name in @("initdb.exe", "pg_ctl.exe", "postgres.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $pgRoot "bin\$name"))) {
      throw "missing postgres\bin\$name"
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $pgRoot "share\postgresql.conf.sample"))) {
    throw "windows postgres share/ layout is missing"
  }
  Copy-Item -LiteralPath (Join-Path $root "packaging\postgres\prelude.sql") -Destination (Join-Path $pgRoot "prelude.sql")
  Copy-Item -LiteralPath (Join-Path $root "packaging\postgres\POSTGRESQL_LICENSE.txt") -Destination (Join-Path $pgRoot "POSTGRESQL_LICENSE.txt")
  $migrations = Join-Path $pgRoot "migrations"
  New-Item -ItemType Directory -Force -Path $migrations | Out-Null
  Copy-Item -Path (Join-Path $root "supabase\migrations\*.sql") -Destination $migrations

  @(
    "platform=windows-amd64"
    "node=v$nodeVersion"
    "node_url=$nodeUrl"
    "node_sha256=$nodeSha"
    "node_license=MIT (NODE_LICENSE)"
    "postgres=16.10.0"
    "postgres_url=$pgUrl"
    "postgres_sha256=$pgSha"
    "postgres_archive=$pgInner"
    "postgres_license=PostgreSQL License (postgres/POSTGRESQL_LICENSE.txt)"
    "erp=linux-built Next.js standalone server.js"
  ) | Set-Content -LiteralPath (Join-Path $dist "PROVENANCE") -Encoding ascii
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "wrote $dist"
