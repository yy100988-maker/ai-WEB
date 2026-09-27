import os

ROOT = r'D:\CODEX\WEB\ai-cloner\src\app'

HOME_TMPL = '''import type {{ Metadata }} from "next";
import {{ SiteHeader }} from "@/components/sites/deevid/SiteHeader";
import {{ SiteFooter }} from "@/components/sites/deevid/SiteFooter";
import {{ HeroComposer }} from "@/components/sites/deevid/HeroComposer";
import {{ FeatureCards, HowItWorks }} from "@/components/sites/deevid/Sections";
import {{
  CtaFinal,
  HomeFaq,
  ModelWall,
  TemplatesSection,
  Testimonials,
}} from "@/components/sites/deevid/HomeSections";

export const metadata: Metadata = {{
  title: "{title}",
}};

export default function Page() {{
  return (
    <>
      <SiteHeader locale="{loc}" base="/{base}" />
      <main>
        <HeroComposer locale="{loc}" />
        <HowItWorks locale="{loc}" />
        <FeatureCards locale="{loc}" />
        <TemplatesSection locale="{loc}" />
        <Testimonials locale="{loc}" />
        <ModelWall locale="{loc}" />
        <CtaFinal locale="{loc}" />
        <HomeFaq locale="{loc}" />
      </main>
      <SiteFooter locale="{loc}" />
    </>
  );
}}
'''

TOOL_TMPL = '''import type {{ Metadata }} from "next";
import {{ {comp} }} from "@/components/sites/deevid/ToolPages";

export const metadata: Metadata = {{
  title: "{title}",
}};

export default function Page() {{
  return <{comp} locale="{loc}" base="/{base}" />;
}}
'''

PAGES = {
    'ja': 'DeeVid AI \u524d\u5794 — \u7121\u6599 AI \u52d5\u753b\u751f\u6210',
    'ko': 'DeeVid AI \ubcf5\uc81c — \ubb34\ub8cc AI \uc601\uc0c1 \uc0dd\uc131',
    'es': 'R\u00e9plica DeeVid AI — generador gratis',
    'fr': 'R\u00e9plique DeeVid AI — g\u00e9n\u00e9rateur gratuit',
    'de': 'DeeVid AI Nachbau — gratis KI-Videos',
    'it': 'Replica DeeVid AI — video gratis',
    'pt': 'R\u00e9plica DeeVid AI — v\u00eddeos gr\u00e1tis',
    'zh-CN': 'DeeVid AI \u590d\u523b — \u514d\u8d39 AI \u89c6\u9891\u751f\u6210\u5668',
}

TOOLS = [
    ('text-to-video', 'TextToVideoPage'),
    ('image-to-video', 'ImageToVideoPage'),
    ('pricing', 'PricingPage'),
]

n = 0
for loc, title in PAGES.items():
    d = os.path.join(ROOT, loc)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'page.tsx'), 'w', encoding='utf-8') as f:
        f.write(HOME_TMPL.format(loc=loc, base=loc, title=title))
    n += 1
    for slug, comp in TOOLS:
        dd = os.path.join(d, slug)
        os.makedirs(dd, exist_ok=True)
        with open(os.path.join(dd, 'page.tsx'), 'w', encoding='utf-8') as f:
            f.write(TOOL_TMPL.format(loc=loc, base=loc, comp=comp, title=f'{title} | {slug}'))
        n += 1

print(f'generated {n} route files')
