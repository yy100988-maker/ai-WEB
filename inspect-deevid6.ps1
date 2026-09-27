$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== all width params ==="
$r = [regex]'width=(\d+)/user-image'
$seen = @{}
foreach ($m in $r.Matches($html)) {
  if (-not $seen.ContainsKey($m.Groups[1].Value)) { $seen[$m.Groups[1].Value] = 1 }
}
$seen.Keys | Sort-Object
"=== width=520 urls ==="
$r2 = [regex]'https://cdn2\.deevid\.ai/cdn-cgi/image/format=webp,width=520[^"''\s]*'
$seen2 = @{}
foreach ($m in $r2.Matches($html)) {
  if (-not $seen2.ContainsKey($m.Value)) { $seen2[$m.Value] = 1; $m.Value }
}
"=== mp4 sizes ==="
