$html = Get-Content $env:TEMP\deevid-home.html -Raw -Encoding utf8
"=== header markup ==="
$i = $html.IndexOf('</nav></header>')
$html.Substring([Math]::Max(0,$i-1500), 1500)
"=== composer box (via textarea anchor) ==="
$k = $html.IndexOf('<textarea')
$html.Substring([Math]::Max(0,$k-1000), 1600)
