import os

ROOT = r'D:\CODEX\WEB\ai-cloner\src\app'
LOC = 'ru'
TITLE = 'Vutu AI \u2014 \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u0439 \u0418\u0418-\u0433\u0435\u043d\u0435\u0440\u0430\u0442\u043e\u0440 \u0432\u0438\u0434\u0435\u043e'

HOME = '''import type {{ Metadata }} from "next";
import {{ SiteHeader }} from "@/components/sites/vutu/SiteHeader";
import {{ SiteFooter }} from "@/components/sites/vutu/SiteFooter";
import {{ HeroComposer }} from "@/components/sites/vutu/HeroComposer";
import {{ FeatureCards, HowItWorks }} from "@/components/sites/vutu/Sections";
import {{
  CtaFinal,
  HomeFaq,
  ModelWall,
  TemplatesSection,
  Testimonials,
}} from "@/components/sites/vutu/HomeSections";

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

TOOL = '''import type {{ Metadata }} from "next";
import {{ {comp} }} from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {{
  title: "{title} | {slug}",
}};

export default function Page() {{
  return <{comp} locale="{loc}" base="/{base}" />;
}}
'''

n = 0
d = os.path.join(ROOT, LOC)
os.makedirs(d, exist_ok=True)
with open(os.path.join(d, 'page.tsx'), 'w', encoding='utf-8') as f:
    f.write(HOME.format(loc=LOC, base=LOC, title=TITLE))
n += 1
for slug, comp in [('text-to-video', 'TextToVideoPage'),
                   ('image-to-video', 'ImageToVideoPage'),
                   ('pricing', 'PricingPage')]:
    dd = os.path.join(d, slug)
    os.makedirs(dd, exist_ok=True)
    with open(os.path.join(dd, 'page.tsx'), 'w', encoding='utf-8') as f:
        f.write(TOOL.format(loc=LOC, base=LOC, comp=comp, title=TITLE, slug=slug))
    n += 1
print(f'generated {n} ru route files')
