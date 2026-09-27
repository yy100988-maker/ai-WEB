import os

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
LOCDIR = os.path.join(BASE, 'locales')

# menus[1..4] for each locale: (head, [(title, desc), ...])
M = {}

M['zh-CN'] = [
    ('资源', [('提示词库', '浏览并复用高质量提示词'), ('CLI 与 MCP', '在命令行与代理中调用 Vutu'), ('联系客服', '获取协助与答疑')]),
    ('应用场景', [('电商与商品图', '批量产出一致的商品视觉'), ('短视频与口播', '快速做出可投放的素材'), ('品牌与广告', '多平台广告一次生成'), ('教育与解说', '把知识点变成影片')]),
    ('指南', [('快速开始', '五分钟跑通第一条影片'), ('提示词技巧', '写出更稳的提示词'), ('常见问题', '配额、导出与版权')]),
    ('价格方案', [('免费版', '每日点数，随时试做'), ('专业版', '更高解析度与去水印'), ('企业版', '团队协作与 API')]),
]
M['en'] = [
    ('Resources', [('Prompt library', 'Browse and reuse strong prompts'), ('CLI & MCP', 'Drive Vutu from your terminal'), ('Contact support', 'Get help and answers')]),
    ('Use cases', [('E-commerce visuals', 'Consistent product shots in bulk'), ('Short video & UGC', 'Shippable creative, fast'), ('Brand & ads', 'Multi-platform ads in one pass'), ('Education', 'Turn knowledge into video')]),
    ('Guide', [('Quick start', 'Ship your first video in five minutes'), ('Prompt tips', 'Write steadier prompts'), ('FAQ', 'Credits, exports, and rights')]),
    ('Pricing', [('Free', 'Daily credits to try it out'), ('Pro', 'Higher resolution, no watermark'), ('Business', 'Team workspace and API')]),
]
M['zh-TW'] = [
    ('資源', [('提示詞庫', '瀏覽並重複使用高品質提示詞'), ('CLI 與 MCP', '在命令列與代理中呼叫 Vutu'), ('聯絡客服', '取得協助與答疑')]),
    ('應用場景', [('電商與商品圖', '批次產出一致的商品視覺'), ('短影音與口播', '快速做出可投放的素材'), ('品牌與廣告', '多平台廣告一次生成'), ('教育與解說', '把知識點變成影片')]),
    ('指南', [('快速開始', '五分鐘跑通第一支影片'), ('提示詞技巧', '寫出更穩的提示詞'), ('常見問題', '配額、匯出與版權')]),
    ('價格方案', [('免費版', '每日點數，隨時試做'), ('專業版', '更高解析度與去浮水印'), ('企業版', '團隊協作與 API')]),
]
M['ja'] = [
    ('リソース', [('プロンプト集', '良質なプロンプトを再利用'), ('CLI と MCP', 'ターミナルから Vutu を操作'), ('サポート', 'ヘルプと回答')]),
    ('活用シーン', [('EC・商品画像', '一貫した商品ビジュアルを量産'), ('ショート動画', 'すぐ配信できる素材'), ('ブランド広告', '複数媒体の広告を一括生成'), ('教育・解説', '知識を動画に')]),
    ('ガイド', [('クイックスタート', '5分で最初の1本'), ('プロンプトのコツ', '安定した指示の書き方'), ('よくある質問', 'クレジット・書き出し・権利')]),
    ('価格設定', [('無料', '毎日のクレジットで試す'), ('プロ', '高解像度・透かしなし'), ('ビジネス', 'チームと API')]),
]
M['ko'] = [
    ('리소스', [('프롬프트 모음', '좋은 프롬프트 재사용'), ('CLI와 MCP', '터미널에서 Vutu 제어'), ('고객 지원', '도움과 답변')]),
    ('활용 사례', [('이커머스 비주얼', '일관된 상품 이미지 대량 제작'), ('숏폼·UGC', '바로 쓸 수 있는 소재'), ('브랜드 광고', '여러 매체 광고 한 번에'), ('교육·해설', '지식을 영상으로')]),
    ('가이드', [('빠른 시작', '5분 만에 첫 영상'), ('프롬프트 팁', '안정적인 지시문 작성'), ('자주 묻는 질문', '크레딧·내보내기·권리')]),
    ('가격', [('무료', '매일 크레딧으로 체험'), ('프로', '고해상도·워터마크 없음'), ('비즈니스', '팀과 API')]),
]
M['es'] = [
    ('Recursos', [('Biblioteca de prompts', 'Reutiliza prompts sólidos'), ('CLI y MCP', 'Controla Vutu desde la terminal'), ('Soporte', 'Ayuda y respuestas')]),
    ('Casos de uso', [('Visuales e-commerce', 'Fotos de producto consistentes'), ('Short video y UGC', 'Creatividades listas'), ('Marca y anuncios', 'Anuncios multipantalla'), ('Educación', 'Convierte conocimiento en vídeo')]),
    ('Guía', [('Inicio rápido', 'Tu primer vídeo en cinco minutos'), ('Trucos de prompts', 'Instrucciones más estables'), ('FAQ', 'Créditos, exportación y derechos')]),
    ('Precios', [('Gratis', 'Créditos diarios para probar'), ('Pro', 'Más resolución, sin marca'), ('Negocios', 'Equipo y API')]),
]
M['fr'] = [
    ('Ressources', [('Bibliothèque de prompts', 'Réutilisez de bons prompts'), ('CLI et MCP', 'Pilotez Vutu en terminal'), ('Support', 'Aide et réponses')]),
    ('Cas d’usage', [('Visuels e-commerce', 'Photos produit cohérentes'), ('Short vidéo et UGC', 'Créas prêtes à diffuser'), ('Marque et pubs', 'Pubs multi-plateformes'), ('Éducation', 'Transformer le savoir en vidéo')]),
    ('Guide', [('Démarrage rapide', 'Votre première vidéo en 5 minutes'), ('Astuces de prompt', 'Des consignes plus stables'), ('FAQ', 'Crédits, exports, droits')]),
    ('Tarifs', [('Gratuit', 'Crédits quotidiens'), ('Pro', 'Plus de résolution, sans filigrane'), ('Business', 'Équipe et API')]),
]
M['de'] = [
    ('Ressourcen', [('Prompt-Bibliothek', 'Gute Prompts wiederverwenden'), ('CLI & MCP', 'Vutu im Terminal steuern'), ('Support', 'Hilfe und Antworten')]),
    ('Anwendungsfälle', [('E-Commerce-Visuals', 'Konsistente Produktbilder'), ('Short-Video & UGC', 'Sofort einsetzbares Material'), ('Marke & Ads', 'Ads für alle Kanäle'), ('Bildung', 'Wissen als Video')]),
    ('Anleitung', [('Schnellstart', 'Erstes Video in fünf Minuten'), ('Prompt-Tipps', 'Stabilere Anweisungen'), ('FAQ', 'Credits, Export, Rechte')]),
    ('Preise', [('Gratis', 'Tägliche Credits'), ('Pro', 'Mehr Auflösung, kein Wasserzeichen'), ('Business', 'Team und API')]),
]
M['it'] = [
    ('Risorse', [('Libreria prompt', 'Riusa prompt efficaci'), ('CLI e MCP', 'Guida Vutu da terminale'), ('Supporto', 'Aiuto e risposte')]),
    ('Casi d’uso', [('Visual e-commerce', 'Foto prodotto coerenti'), ('Short video e UGC', 'Creatività pronte'), ('Brand e annunci', 'Annunci multipiattaforma'), ('Formazione', 'Conoscenza in video')]),
    ('Guida', [('Avvio rapido', 'Primo video in cinque minuti'), ('Consigli sui prompt', 'Istruzioni più stabili'), ('FAQ', 'Crediti, export, diritti')]),
    ('Prezzi', [('Gratis', 'Crediti giornalieri'), ('Pro', 'Più risoluzione, senza watermark'), ('Business', 'Team e API')]),
]
M['pt'] = [
    ('Recursos', [('Biblioteca de prompts', 'Reutilize prompts fortes'), ('CLI e MCP', 'Controle o Vutu no terminal'), ('Suporte', 'Ajuda e respostas')]),
    ('Casos de uso', [('Visuais e-commerce', 'Fotos de produto consistentes'), ('Short video e UGC', 'Criativos prontos'), ('Marca e anúncios', 'Anúncios multiplataforma'), ('Educação', 'Conhecimento em vídeo')]),
    ('Guia', [('Início rápido', 'Primeiro vídeo em cinco minutos'), ('Dicas de prompt', 'Instruções mais estáveis'), ('FAQ', 'Créditos, exportação, direitos')]),
    ('Preços', [('Grátis', 'Créditos diários'), ('Pro', 'Mais resolução, sem marca'), ('Negócios', 'Equipe e API')]),
]
M['ru'] = [
    ('Ресурсы', [('Библиотека промптов', 'Переиспользуйте удачные промпты'), ('CLI и MCP', 'Управляйте Vutu из терминала'), ('Поддержка', 'Помощь и ответы')]),
    ('Сценарии', [('E-commerce визуалы', 'Серийные фото товаров'), ('Short video и UGC', 'Готовые креативы'), ('Бренд и реклама', 'Реклама для всех площадок'), ('Образование', 'Знания в видео')]),
    ('Гайд', [('Быстрый старт', 'Первое видео за пять минут'), ('Советы по промптам', 'Более устойчивые指令'.replace('指令', ' инструкции')), ('FAQ', 'Кредиты, экспорт, права')]),
    ('Тарифы', [('Бесплатный', 'Ежедневные кредиты'), ('Pro', 'Выше разрешение, без знака'), ('Бизнес', 'Команда и API')]),
]


def fmt(cols):
    out = []
    for c in cols:
        out.append('    { head: "%s", items: [' % c[0])
        for t, d in c[1]:
            out.append('      { t: "%s", d: "%s" },' % (t, d))
        out.append('    ] },')
    return '\n'.join(out)


# main: zh-TW menus as `menus2`
p = os.path.join(BASE, 'site-data.ts')
s = open(p, encoding='utf-8').read()
if 'menus2' not in s:
    s = s.replace('  mega: { head: string; items: { t: string; d: string }[] }[];',
                  '  mega: { head: string; items: { t: string; d: string }[] }[];\n'
                  '  menus2: { head: string; items: { t: string; d: string }[] }[];')
    block = '  menus2: [\n' + fmt(M['zh-TW']) + '\n  ],\n'
    s = s.replace('  mega: [', block + '  mega: [', 1)
    block_en = '  menus2: [\n' + fmt(M['en']) + '\n  ],\n'
    i = s.find('  mega: [', s.find('const en:'))
    s = s[:i] + block_en + s[i:]
    open(p, 'w', encoding='utf-8').write(s)
    print('main menus2 added')

for loc, cols in M.items():
    if loc in ('zh-TW', 'en'):
        continue
    fp = os.path.join(LOCDIR, loc + '.ts')
    s = open(fp, encoding='utf-8').read()
    if 'menus2' in s:
        print('skip', loc)
        continue
    s = s.replace('  mega: [', '  menus2: [\n' + fmt(cols) + '\n  ],\n  mega: [', 1)
    open(fp, 'w', encoding='utf-8').write(s)
    print('menus2 added:', loc)
