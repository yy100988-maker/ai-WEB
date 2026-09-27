$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
$r = [regex]'<img[^>]*alt="([^"]+)"[^>]*>'
$want = @("Linda","Jesse","Lara","Mia")
for ($n = 1; $n -le 8; $n++) { $want += "模板 $n" }
$feat = @("AI 廣告產生器","AI 圖片產生器","AI 虛擬分身","AI 音樂","圖片轉影片","文字轉語音")
$want += $feat
foreach ($m in $r.Matches($html)) {
  $alt = $m.Groups[1].Value
  if ($want -contains $alt) {
    $tag = $m.Value
    $src = ""
    $rm = [regex]'src="([^"]+)"'
    $sm = $rm.Match($tag)
    if ($sm.Success) { $src = $sm.Groups[1].Value }
    "$alt :: $src"
  }
}
