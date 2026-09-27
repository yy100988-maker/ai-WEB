import os

ROOT = r'D:\CODEX\WEB\ai-cloner\src\app'

TMPL = '''import type {{ Metadata }} from "next";
import {{ AppHomePage }} from "@/components/sites/vutu/AppHomePage";

export const metadata: Metadata = {{
  title: "{title}",
  robots: {{ index: false, follow: false }},
}};

export default function Page() {{
  return <AppHomePage locale="{loc}" base="/{base}" />;
}}
'''

LOCALES = {
    'en': 'Vutu App Home',
    'zh-TW': 'Vutu App \u9996\u9801',
    'zh-CN': 'Vutu App \u9996\u9875',
    'ja': 'Vutu App \u30db\u30fc\u30e0',
    'ko': 'Vutu App \ud648',
    'es': 'Vutu App',
    'fr': 'Vutu App',
    'de': 'Vutu App',
    'it': 'Vutu App',
    'pt': 'Vutu App',
    'ru': 'Vutu App',
}

n = 0
for loc, title in LOCALES.items():
    d = os.path.join(ROOT, loc, 'app')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'page.tsx'), 'w', encoding='utf-8') as f:
        f.write(TMPL.format(loc=loc, base=loc, title=title))
    n += 1
print(f'generated {n} app routes')
