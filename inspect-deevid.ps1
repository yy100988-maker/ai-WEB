$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== H2/header text classes ==="
$r = [regex]'class="([^"]{0,220})"[^>]{0,300}>\s*(運作方式|功能特色)'
foreach ($m in $r.Matches($html)) { $m.Groups[1].Value }
"=== body class ==="
$r2 = [regex]'<body[^>]*class="([^"]*)"'
$r2.Match($html).Groups[1].Value
"=== section classes ==="
$r4 = [regex]'<section class="([^"]*)"'
$seen = @{}
foreach ($m in $r4.Matches($html)) {
  $v = $m.Groups[1].Value
  if (-not $seen.ContainsKey($v)) { $seen[$v] = 1; $v }
}
"=== header/nav ==="
$i = $html.IndexOf('價格方案')
$html.Substring([Math]::Max(0,$i-1200), 1200)
