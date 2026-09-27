$cssDir = "$env:TEMP\deevid-css"
$files = Get-ChildItem $cssDir -Filter *.css
"=== bg-app + brand colors ==="
foreach ($f in $files) {
  $t = Get-Content $f.FullName -Raw -Encoding utf8
  $r = [regex]'--bg-app:[^;]+|#7B35FA|#7b35fa|--brand[^:]*:[^;]+'
  foreach ($m in $r.Matches($t)) { $f.Name + " :: " + $m.Value }
}
"=== hero h2 / section title sizes ==="
foreach ($f in $files) {
  $t = Get-Content $f.FullName -Raw -Encoding utf8
  $r = [regex]'\.md\\:text-\[[^\]]+\][^{]*\{[^}]{0,120}'
  $n = 0
  foreach ($m in $r.Matches($t)) { if ($n -lt 12) { $f.Name + " :: " + $m.Value }; $n++ }
}
"=== inter font-face ==="
foreach ($f in $files) {
  $t = Get-Content $f.FullName -Raw -Encoding utf8
  if ($t -match 'font-family:\s*"?__Inter') { $f.Name + " has Inter" }
  $r = [regex]'@font-face\{[^}]{0,400}'
  foreach ($m in $r.Matches($t)) {
    if ($m.Value -match 'Inter|Poppins|Jakarta') { $f.Name + " :: " + $m.Value.Substring(0, [Math]::Min(200, $m.Value.Length)) }
  }
}
