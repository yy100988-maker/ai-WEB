$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== 176/1600 urls ==="
$r = [regex]'https://cdn2\.deevid\.ai/cdn-cgi/image/format=webp,width=(176|1600)[^"''\s]*'
$seen = @{}
foreach ($m in $r.Matches($html)) {
  if (-not $seen.ContainsKey($m.Value)) { $seen[$m.Value] = 1; $m.Value }
}
"=== img tags near template keyword ==="
$idx = 0
$r2 = [regex]'alt="([^"]*)"'
foreach ($m in $r2.Matches($html)) {
  $alt = $m.Groups[1].Value
  if ($alt -match '^[A-Za-z0-9 ]+$' -and $alt.Length -lt 30 -and $alt -notmatch '^(DeeVid|展示|Linda|Veo|Dall-E)$') { }
}
"=== all alt values (images) ==="
$alts = @{}
foreach ($m in $r2.Matches($html)) {
  $a = $m.Groups[1].Value
  if ($a -ne "" -and -not $alts.ContainsKey($a)) { $alts[$a] = 1 }
}
$alts.Keys | Sort-Object
