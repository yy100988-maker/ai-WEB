import re

html = open(r'C:\Users\y2ksk\AppData\Local\Temp\deevid-home.html', encoding='utf-8').read()

print('=== testimonial quotes ===')
for m in re.finditer(r'<p class="text-\[12px\] leading-\[18px\] text-\[#5c5c5c\]">([^<]{20,400})</p>', html):
    print('-', m.group(1)[:200])

print('=== testimonial names/roles ===')
for m in re.finditer(r'<p class="text-\[18px\] font-bold text-\[#5c5c5c\]">([^<]+)</p><p class="text-\[12px\] font-medium text-\[#5c5c5c\]">([^<]+)</p>', html):
    print('-', m.group(1), '/', m.group(2))

print('=== homepage FAQ answers (first 300 chars each) ===')
for m in re.finditer(r'DeeVid 2\.0[^<]{0,50}', html):
    pass
idx = html.find('DeeVid 2.0')
print('faq area idx:', idx)
