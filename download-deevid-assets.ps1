$base = "D:\CODEX\WEB\ai-cloner\public\sites\deevid"
New-Item -ItemType Directory -Force "$base\hero" | Out-Null
New-Item -ItemType Directory -Force "$base\features" | Out-Null
New-Item -ItemType Directory -Force "$base\showcase" | Out-Null
New-Item -ItemType Directory -Force "$base\avatars" | Out-Null
$cdn = "https://cdn2.deevid.ai/cdn-cgi/image/format=webp,width="
$jobs = @(
  @("$base\hero", "hero-main.png", "${cdn}1700/user-image/v2_1776761180472-840893136.png"),
  @("$base\hero", "hero-wide-1.jpg", "${cdn}1700/user-image/v2_1776761175543-32504785.jpg"),
  @("$base\hero", "hero-wide-2.jpg", "${cdn}1700/user-image/v2_1776761186364-98676581.jpg"),
  @("$base\showcase", "show-1.png", "${cdn}1200/user-image/v2_1776761199892-209300799.png"),
  @("$base\showcase", "show-2.png", "${cdn}1200/user-image/v2_1776761204418-788182977.png"),
  @("$base\showcase", "show-3.png", "${cdn}1200/user-image/v2_1776761209004-477608339.png"),
  @("$base\showcase", "row-01.png", "${cdn}800/user-image/v2_1776757597623-511061755.png"),
  @("$base\showcase", "row-02.jpg", "${cdn}800/user-image/v2_1776759541472-52038524.jpg"),
  @("$base\showcase", "row-03.jpg", "${cdn}800/user-image/v2_1776755998100-662925956.jpg"),
  @("$base\showcase", "row-04.png", "${cdn}800/user-image/v2_1776755140980-919465703.png"),
  @("$base\showcase", "row-05.jpg", "${cdn}800/user-image/v2_1776757051059-988692042.jpg"),
  @("$base\showcase", "row-06.png", "${cdn}800/user-image/v2_1776755520199-443920001.png"),
  @("$base\showcase", "row-07.png", "${cdn}800/user-image/v2_1776756584094-938065460.png"),
  @("$base\showcase", "row-08.png", "${cdn}800/user-image/v2_1776755560842-77112421.png"),
  @("$base\showcase", "row-09.png", "${cdn}800/user-image/v2_1776756954231-274056186.png"),
  @("$base\showcase", "row-10.png", "${cdn}800/user-image/v2_1776755176626-29498404.png"),
  @("$base\features", "feat-1.png", "${cdn}320/user-image/v2_1776745018720-464558345.png"),
  @("$base\features", "feat-2.png", "${cdn}320/user-image/v2_1776745048187-875386355.png"),
  @("$base\features", "feat-3.png", "${cdn}320/user-image/v2_1776745066787-907185874.png"),
  @("$base\features", "feat-4.png", "${cdn}320/user-image/v2_1776745082599-833803964.png"),
  @("$base\features", "feat-5.png", "${cdn}320/user-image/v2_1776745100197-820367347.png"),
  @("$base\features", "feat-6.png", "${cdn}320/user-image/v2_1776745117436-741317944.png"),
  @("$base\avatars", "av-01.png", "${cdn}240/user-image/v2_1776752497292-87736716.png"),
  @("$base\avatars", "av-02.png", "${cdn}240/user-image/v2_1776752493697-52060983.png"),
  @("$base\avatars", "av-03.png", "${cdn}240/user-image/v2_1776752489581-802971982.png"),
  @("$base\avatars", "av-04.png", "${cdn}240/user-image/v2_1776752486492-21856318.png"),
  @("$base\avatars", "av-05.png", "${cdn}240/user-image/v2_1776752482535-979528303.png"),
  @("$base\avatars", "av-06.png", "${cdn}240/user-image/v2_1776752478501-883379865.png"),
  @("$base\avatars", "av-07.png", "${cdn}240/user-image/v2_1776752475233-872684160.png"),
  @("$base\avatars", "av-08.png", "${cdn}240/user-image/v2_1776752472055-24732835.png"),
  @("$base\avatars", "av-09.png", "${cdn}240/user-image/v2_1776752468407-576981196.png"),
  @("$base\avatars", "av-10.png", "${cdn}240/user-image/v2_1776752465840-888019731.png")
)
curl.exe -s -m 30 -A "Mozilla/5.0" "https://deevid.ai/app/favicon.svg?v=1" -o "$base\favicon.svg"
$ok = 0; $fail = 0
foreach ($j in $jobs) {
  curl.exe -s -m 60 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" $j[2] -o (Join-Path $j[0] $j[1])
  if ((Test-Path (Join-Path $j[0] $j[1])) -and ((Get-Item (Join-Path $j[0] $j[1])).Length -gt 1024)) { $ok++ } else { $fail++; "FAIL: " + $j[1] }
}
"done ok=$ok fail=$fail"
Get-ChildItem $base -Recurse -File | Measure-Object -Property Length -Sum | Select-Object Count, @{N='MB';E={[math]::Round($_.Sum/1MB,2)}}
