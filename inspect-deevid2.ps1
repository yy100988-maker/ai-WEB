$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== CSS chunk urls ==="
$r = [regex]'/app/_next/static/chunks/[^"]+?\.css'
$seen = @{}
foreach ($m in $r.Matches($html)) {
  $v = $m.Value
  if (-not $seen.ContainsKey($v)) { $seen[$v] = 1; $v }
}
"=== hero section bg + composer ==="
$i = $html.IndexOf('pt-[104px]')
$html.Substring([Math]::Max(0,$i-400), 400)
"=== H1 sub text class ==="
$j = $html.IndexOf('一站式 AI')
$html.Substring([Math]::Max(0,$j-500), 500)
