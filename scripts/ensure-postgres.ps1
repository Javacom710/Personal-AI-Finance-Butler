# Ensure the local PostgreSQL instance is running.
#
# The development instance is portable, started by hand, and does not run as a
# Windows service (PROJECT-STATE.md, decision D-9). It is launched here through
# WMI so the server does not belong to the shell's process tree — a postmaster
# started as a child of a terminal dies with that terminal, which is how a test
# run loses its database halfway through.
#
#   powershell -File scripts/ensure-postgres.ps1
#
# Exits 0 once the server accepts connections, 1 if it cannot be started.

$ErrorActionPreference = 'Stop'

$PgBin   = 'E:\Claude\_tools\pg17\pgsql\bin'
$PgData  = 'E:\Claude\_tools\pgdata'
$PgLog   = 'E:\Claude\_tools\pg.log'

function Test-PgReady {
    & "$PgBin\pg_isready.exe" -h 127.0.0.1 -p 5432 -q 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

if (Test-PgReady) {
    Write-Output 'postgres: already accepting connections'
    exit 0
}

# A pid file left by a killed postmaster stops a fresh one from starting.
$pidFile = Join-Path $PgData 'postmaster.pid'
if (Test-Path $pidFile) {
    $running = @(Get-Process postgres -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        Remove-Item $pidFile -Force
        Write-Output 'postgres: removed a stale postmaster.pid'
    }
}

$command = '"{0}\pg_ctl.exe" -D "{1}" -l "{2}" start' -f $PgBin, $PgData, $PgLog
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command }

if ($result.ReturnValue -ne 0) {
    Write-Error "postgres: Win32_Process.Create failed with $($result.ReturnValue)"
    exit 1
}

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PgReady) {
        Write-Output "postgres: started after $($i + 1)s"
        exit 0
    }
}

Write-Error 'postgres: did not become ready within 60s'
exit 1
