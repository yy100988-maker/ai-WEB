import os

D = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu\locales'

QUICK = '''    quick: [
      { t: "%(q1)s", s: "%(q1s)s", img: "/sites/vutu/showcase/row-01.png" },
      { t: "%(q2)s", img: "/sites/vutu/templates/tpl-3.jpg" },
      { t: "%(q3)s", img: "/sites/vutu/showcase/row-05.jpg" },
      { t: "%(q4)s", s: "%(q4s)s", img: "/sites/vutu/showcase/show-1.png" },
      { t: "%(q5)s", s: "%(q5s)s", img: "/sites/vutu/showcase/row-02.jpg" },
      { t: "%(q6)s", img: "/sites/vutu/showcase/row-06.png" },
      { t: "%(q7)s", img: "/sites/vutu/showcase/row-07.png" },
    ],'''

TMPL = '''  app: {{
    promo: "{promo}",
    promoPrice: "{promoPrice}",
    promoCta: "{promoCta}",
    agentBtn: "{agentBtn}",
    toolsHead: "{toolsHead}",
    tools: [{tools}],
    studioHead: "{studioHead}",
    studios: [{{ t: "{s1}"{b1} }}, {{ t: "{s2}" }}, {{ t: "{s3}" }}],
    assets: "{assets}",
    explore: "{explore}",
    support: "{support}",
    language: "{language}",
    planName: "{planName}",
    upgrade: "{upgrade}",
    heroA: "{heroA}",
    heroB: "{heroB}",
    heroSub: "{heroSub}",
    composerPh: "{composerPh}",
    chipAgent: "Agent",
    chipSkill: "{chipSkill}",
    chipAsk: "{chipAsk}",
    create: "{create}",
    quickTitle: "{quickTitle}",
{quick}
    inspTitle: "{inspTitle}",
    backV1: "Vutu 1.0",
  }},
}};'''

L = {}

L['ja'] = dict(
    promo='新規ユーザーは 50% オフ！', promoPrice='月たった $7 + 200 クレジット',
    promoCta='今すぐ登録', agentBtn='Agent で作成', toolsHead='AI ツール',
    tools='"AI 動画", "AI 画像", "AI 音声", "キャンバス", "エディター"',
    studioHead='AI スタジオ', s1='バイラルスタジオ', b1=', badge: "New"',
    s2='話すアバター', s3='動画翻訳', assets='アセット', explore='探索',
    support='サポート', language='言語', planName='無料プラン', upgrade='アップグレード',
    heroA='アイデアから公開まで。', heroB='Vutu Agent におまかせ。',
    heroSub='動画・画像・アバター・音声・音楽のためのオールインワン AI ディレクター。',
    composerPh='テキスト・画像・動画・音声・ファイル・URL で何でも作成。',
    chipSkill='スキル', chipAsk='質問', create='作成', quickTitle='クイックスタート',
    inspTitle='インスピレーション',
    quick=QUICK % dict(q1='AI ドラマ', q1s='短編ドラマの制作計画を策定', q2='キャラ設計',
        q3='漫画', q4='商品画像設計', q4s='一貫した商品画像を量産',
        q5='UGC 広告', q5s='媒体別ネイティブ広告を作成', q6='URL から動画', q7='PDF から動画'))

L['ko'] = dict(
    promo='신규 유저 50% 할인!', promoPrice='월 단돈 $7 + 200 크레딧',
    promoCta='지금 구독', agentBtn='Agent로 만들기', toolsHead='AI 도구',
    tools='"AI 영상", "AI 이미지", "AI 오디오", "캔버스", "에디터"',
    studioHead='AI 스튜디오', s1='바이럴 스튜디오', b1=', badge: "New"',
    s2='말하는 아바타', s3='영상 번역', assets='에셋', explore='탐색',
    support='지원', language='언어', planName='무료 플랜', upgrade='업그레이드',
    heroA='아이디어부터 공개까지.', heroB='Vutu Agent에게 맡기세요.',
    heroSub='영상, 이미지, 아바타, 음성, 음악을 위한 올인원 AI 디렉터.',
    composerPh='텍스트, 이미지, 영상, 오디오, 파일, URL로 무엇이든 만드세요.',
    chipSkill='스킬', chipAsk='질문', create='만들기', quickTitle='빠른 시작',
    inspTitle='영감',
    quick=QUICK % dict(q1='AI 드라마', q1s='단편 드라마 제작 계획 수립', q2='캐릭터 디자인',
        q3='만화', q4='상품 이미지 디자인', q4s='일관된 상품 이미지 대량 제작',
        q5='UGC 광고', q5s='매체별 네이티브 광고 제작', q6='URL을 영상으로', q7='PDF를 영상으로'))

L['es'] = dict(
    promo='¡50% dto. nuevos usuarios!', promoPrice='Solo $7/mes + 200 créditos',
    promoCta='Suscribirse', agentBtn='Crear con Agent', toolsHead='Herramientas IA',
    tools='"Video IA", "Imagen IA", "Audio IA", "Lienzo", "Editor"',
    studioHead='Estudio IA', s1='Estudio viral', b1=', badge: "New"',
    s2='Avatar parlante', s3='Traducir vídeo', assets='Assets', explore='Explorar',
    support='Soporte', language='Idioma', planName='Plan gratis', upgrade='Mejorar',
    heroA='De la idea a publicar.', heroB='Déjaselo a Vutu Agent.',
    heroSub='Director IA todo en uno para video, imagen, avatar, voz y música.',
    composerPh='Crea de todo con texto, imágenes, video, audio, archivos o URL.',
    chipSkill='Skills', chipAsk='Preguntar', create='Crear', quickTitle='Inicio rápido',
    inspTitle='Inspiración',
    quick=QUICK % dict(q1='Miniserie IA', q1s='Planifica una miniserie completa', q2='Personajes',
        q3='Cómic', q4='Foto producto', q4s='Imágenes consistentes en lote',
        q5='Anuncios UGC', q5s='Anuncios nativos por plataforma', q6='URL a vídeo', q7='PDF a vídeo'))

L['fr'] = dict(
    promo='-50% nouveaux utilisateurs !', promoPrice='Seulement 7 $/mois + 200 crédits',
    promoCta="S'abonner", agentBtn='Créer avec Agent', toolsHead='Outils IA',
    tools='"Vidéo IA", "Image IA", "Audio IA", "Canvas", "Éditeur"',
    studioHead='Studio IA', s1='Studio viral', b1=', badge: "New"',
    s2='Avatar parlant', s3='Traduire vidéo', assets='Assets', explore='Explorer',
    support='Support', language='Langue', planName='Plan gratuit', upgrade='Passer au pro',
    heroA="De l'idée à la publication.", heroB='Confiez à Vutu Agent.',
    heroSub="Réalisateur IA tout-en-un pour vidéo, image, avatar, voix et musique.",
    composerPh="Créez de tout avec texte, images, vidéo, audio, fichiers ou URL.",
    chipSkill='Skills', chipAsk='Demander', create='Créer', quickTitle='Démarrage rapide',
    inspTitle='Inspiration',
    quick=QUICK % dict(q1='Mini-série IA', q1s='Planifiez une mini-série complète', q2='Personnages',
        q3='BD', q4='Photo produit', q4s='Visuels cohérents en série',
        q5='Pubs UGC', q5s='Pubs natives par plateforme', q6='URL en vidéo', q7='PDF en vidéo'))

L['de'] = dict(
    promo='50% für Neukunden!', promoPrice='Nur $7/Monat + 200 Credits',
    promoCta='Abonnieren', agentBtn='Mit Agent erstellen', toolsHead='KI-Tools',
    tools='"KI-Video", "KI-Bild", "KI-Audio", "Canvas", "Editor"',
    studioHead='KI-Studio', s1='Viral-Studio', b1=', badge: "New"',
    s2='Sprechender Avatar', s3='Video übersetzen', assets='Assets', explore='Entdecken',
    support='Support', language='Sprache', planName='Gratisplan', upgrade='Upgraden',
    heroA='Von der Idee bis zum Release.', heroB='Überlass es Vutu Agent.',
    heroSub='All-in-one-KI-Regisseur für Video, Bild, Avatar, Sprache und Musik.',
    composerPh='Erstelle alles mit Text, Bildern, Video, Audio, Dateien oder URLs.',
    chipSkill='Skills', chipAsk='Fragen', create='Erstellen', quickTitle='Schnellstart',
    inspTitle='Inspiration',
    quick=QUICK % dict(q1='KI-Serie', q1s='Komplette Miniserie planen', q2='Charaktere',
        q3='Comics', q4='Produktfotos', q4s='Konsistente Bilder in Serie',
        q5='UGC-Ads', q5s='Native Ads je Plattform', q6='URL zu Video', q7='PDF zu Video'))

L['it'] = dict(
    promo='-50% nuovi utenti!', promoPrice='Solo $7/mese + 200 crediti',
    promoCta='Abbonati', agentBtn='Crea con Agent', toolsHead='Strumenti IA',
    tools='"Video IA", "Immagini IA", "Audio IA", "Canvas", "Editor"',
    studioHead='Studio IA', s1='Studio virale', b1=', badge: "New"',
    s2='Avatar parlante', s3='Traduci video', assets='Assets', explore='Esplora',
    support='Supporto', language='Lingua', planName='Piano gratis', upgrade='Passa a pro',
    heroA="Dall'idea alla pubblicazione.", heroB='Pensaci Vutu Agent.',
    heroSub='Regista IA tuttofare per video, immagini, avatar, voce e musica.',
    composerPh='Crea di tutto con testo, immagini, video, audio, file o URL.',
    chipSkill='Skill', chipAsk='Chiedi', create='Crea', quickTitle='Avvio rapido',
    inspTitle='Ispirazione',
    quick=QUICK % dict(q1='Miniserie IA', q1s='Pianifica una miniserie completa', q2='Personaggi',
        q3='Fumetti', q4='Foto prodotto', q4s='Visual coerenti in serie',
        q5='Annunci UGC', q5s='Annunci nativi per piattaforma', q6='URL in video', q7='PDF in video'))

L['pt'] = dict(
    promo='50% off novos usuários!', promoPrice='Só $7/mês + 200 créditos',
    promoCta='Assinar', agentBtn='Criar com Agent', toolsHead='Ferramentas IA',
    tools='"Vídeo IA", "Imagem IA", "Áudio IA", "Canvas", "Editor"',
    studioHead='Estúdio IA', s1='Estúdio viral', b1=', badge: "New"',
    s2='Avatar falante', s3='Traduzir vídeo', assets='Assets', explore='Explorar',
    support='Suporte', language='Idioma', planName='Plano grátis', upgrade='Assinar pro',
    heroA='Da ideia à publicação.', heroB='Deixe com Vutu Agent.',
    heroSub='Diretor de IA completo para vídeo, imagem, avatar, voz e música.',
    composerPh='Crie de tudo com texto, imagens, vídeo, áudio, arquivos ou URL.',
    chipSkill='Skills', chipAsk='Perguntar', create='Criar', quickTitle='Início rápido',
    inspTitle='Inspiração',
    quick=QUICK % dict(q1='Minissérie IA', q1s='Planeje uma minissérie completa', q2='Personagens',
        q3='Quadrinhos', q4='Foto de produto', q4s='Visuais consistentes em lote',
        q5='Anúncios UGC', q5s='Anúncios nativos por plataforma', q6='URL em vídeo', q7='PDF em vídeo'))

L['ru'] = dict(
    promo='Скидка 50% новичкам!', promoPrice='Всего $7/мес + 200 кредитов',
    promoCta='Подписаться', agentBtn='Создать с Agent', toolsHead='ИИ-инструменты',
    tools='"ИИ-видео", "ИИ-изображения", "ИИ-аудио", "Холст", "Редактор"',
    studioHead='ИИ-студия', s1='Вирусная студия', b1=', badge: "New"',
    s2='Говорящий аватар', s3='Перевод видео', assets='Ассеты', explore='Обзор',
    support='Поддержка', language='Язык', planName='Бесплатный план', upgrade='Улучшить',
    heroA='От идеи до публикации.', heroB='Доверьте Vutu Agent.',
    heroSub='Универсальный ИИ-режиссёр для видео, изображений, аватаров, голоса и музыки.',
    composerPh='Создавайте всё: текст, изображения, видео, аудио, файлы, URL.',
    chipSkill='Навыки', chipAsk='Спросить', create='Создать', quickTitle='Быстрый старт',
    inspTitle='Вдохновение',
    quick=QUICK % dict(q1='ИИ-сериал', q1s='Спланируйте мини-сериал целиком', q2='Персонажи',
        q3='Комиксы', q4='Фото товаров', q4s='Серийные консистентные визуалы',
        q5='UGC-реклама', q5s='Нативная реклама под площадки', q6='URL в видео', q7='PDF в видео'))

for loc, d in L.items():
    p = os.path.join(D, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        t = f.read()
    assert t.rstrip().endswith('};'), loc
    t = t.rstrip()
    t = t[:t.rfind('};')] + TMPL.format(**d)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(t)
    print('injected:', loc)
