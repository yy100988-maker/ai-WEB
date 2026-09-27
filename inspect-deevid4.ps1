$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
function Show-Context([string]$needle, [int]$before, [int]$after) {
  $i = $html.IndexOf($needle)
  if ($i -lt 0) { "NOT FOUND: $needle"; return }
  "--- context of [$needle] idx=$i ---"
  $html.Substring([Math]::Max(0,$i-$before), [Math]::Min($before+$after, $html.Length-[Math]::Max(0,$i-$before)))
}
Show-Context "Linda" 900 800
Show-Context "Seedream" 600 2500
