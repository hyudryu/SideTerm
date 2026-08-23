param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('pause', 'resume')]
  [string]$Action,
  [string]$SessionIdsJson = '[]'
)

$ErrorActionPreference = 'Stop'
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

function Await-WindowsRuntimeOperation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  if (-not $method) { throw 'Windows Runtime task bridge is unavailable.' }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$manager = Await-WindowsRuntimeOperation (
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = @($manager.GetSessions())

if ($Action -eq 'pause') {
  $paused = [System.Collections.Generic.List[string]]::new()
  foreach ($session in $sessions) {
    if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') { continue }
    $accepted = Await-WindowsRuntimeOperation ($session.TryPauseAsync()) ([bool])
    if ($accepted -and -not $paused.Contains($session.SourceAppUserModelId)) {
      $paused.Add($session.SourceAppUserModelId)
    }
  }
  [pscustomobject]@{ sessionIds = @($paused) } | ConvertTo-Json -Compress
  exit 0
}

$requested = @($SessionIdsJson | ConvertFrom-Json) | ForEach-Object { [string]$_ }
$resumed = 0
foreach ($session in $sessions) {
  if ($requested -notcontains $session.SourceAppUserModelId) { continue }
  if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Paused') { continue }
  if (Await-WindowsRuntimeOperation ($session.TryPlayAsync()) ([bool])) { $resumed += 1 }
}
[pscustomobject]@{ resumed = $resumed } | ConvertTo-Json -Compress
