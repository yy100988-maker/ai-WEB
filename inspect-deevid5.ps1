$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== template images (width=400/600) ==="
$r = [regex]'https://cdn2\.deevid\.ai/cdn-cgi/image/format=webp,width=(400|600|500)[^"''\s]*'
$seen = @{}
foreach ($m in $r.Matches($html)) {
  if (-not $seen.ContainsKey($m.Value)) { $seen[$m.Value] = 1; $m.Value }
}
"=== video posters/sources ==="
$r2 = [regex]'<video[^>]{0,400}'
$n = 0
foreach ($m in $r2.Matches($html)) { if ($n -lt 4) { $m.Value }; $n++ }
"=== mp4 urls ==="
$r3 = [regex]'https://[^"''\s]+\.mp4[^"''\s]*'
$seen3 = @{}
foreach ($m in $r3.Matches($html)) {
  if (-not $seen3.ContainsKey($m.Value)) { $seen3[$m.Value] = 1; $m.Value }
}
