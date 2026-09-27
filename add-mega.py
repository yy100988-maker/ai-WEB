import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

# mega menu: 5 columns x rows of {title, desc}
MEGA = {
    'zh-CN': [
        ('工具', [('AI 创作 Agent', '使用 AI 規劃、創作與完善'), ('脚本', '从现成的工作流程开始'),
                 ('创作画布', '整理构想并重复使用视觉工作流程'), ('时间轴编辑器', '剪辑、加上字幕、编排并完成影片')]),
        ('AI 影片', [('图片转影片', '将图片制作成动态影片'), ('文字转影片', '根据提示词生成影片'),
                    ('网址转影片', '将任何网页转换成影片'), ('影片转影片', '重新设计、编辑或强化现有影片素材'),
                    ('内容转影片', '使用 Agent 从脚本、文件或媒体开始创作'), ('影片深度图', '把任何影片转成深度图')]),
        ('AI 图像', [('文字转图片', '根据文字创作图片'), ('图片转图片', '重新设计或转换图片'),
                    ('AI 背景移除工具', '移除任何图片的背景'), ('AI 图片升级工具', '将图片提升至更高解析度')]),
        ('AI 音讯', [('AI 音乐', '生成原创音乐'), ('文字转语音', '将文字转换为自然语音')]),
        ('AI 工作室', [('爆款工作室', '创作并重新混合热门影片'), ('AI 短剧', '根据你的想法打造一部短剧'),
                      ('口播虚拟人', '让虚拟分身自然说话'), ('影片翻译', '翻译语音、字幕并同步嘴型')]),
    ],
    'ja': [
        ('ツール', [('AI 制作 Agent', 'AI で企画・制作・仕上げ'), ('スクリプト', '既存のワークフローから開始'),
                  ('制作キャンバス', '構想を整理し視覚ワークフローを再利用'), ('タイムライン編集', '編集・字幕・仕上げ')]),
        ('AI 動画', [('画像から動画', '画像を動く映像に'), ('テキストから動画', 'プロンプトで動画を生成'),
                    ('URL から動画', 'Web ページを動画に変換'), ('動画から動画', '既存素材を再設計・編集'),
                    ('コンテンツから動画', '台本・ファイル・メディアから開始'), ('動画深度マップ', '動画を深度マップに')]),
        ('AI 画像', [('テキストから画像', 'テキストで画像を生成'), ('画像から画像', '再設計・変換'),
                    ('背景リムーバー', '背景を削除'), ('画像アップスケール', '高解像度化')]),
        ('AI 音声', [('AI ミュージック', 'オリジナル楽曲を生成'), ('テキスト読み上げ', '自然な音声に変換')]),
        ('AI スタジオ', [('バイラルスタジオ', '人気動画を再ミックス'), ('AI ドラマ', '短編ドラマを制作'),
                      ('話すアバター', 'アバターに自然に話させる'), ('動画翻訳', '音声・字幕・リップシンク翻訳')]),
    ],
    'ko': [
        ('도구', [('AI 제작 Agent', 'AI로 기획·제작·완성'), ('스크립트', '기존 워크플로로 시작'),
                 ('제작 캔버스', '구상을 정리하고 재사용'), ('타임라인 에디터', '편집·자막·완성')]),
        ('AI 영상', [('이미지→영상', '이미지를 움직이는 영상으로'), ('텍스트→영상', '프롬프트로 영상 생성'),
                   ('URL→영상', '웹페이지를 영상으로'), ('영상→영상', '기존 소재 재설계·편집'),
                   ('콘텐츠→영상', '대본·파일·미디어로 시작'), ('영상 뎁스맵', '영상을 뎁스맵으로')]),
        ('AI 이미지', [('텍스트→이미지', '텍스트로 이미지 생성'), ('이미지→이미지', '재설계·변환'),
                     ('배경 제거', '배경 삭제'), ('이미지 업스케일', '고해상도화')]),
        ('AI 오디오', [('AI 음악', '오리지널 음악 생성'), ('텍스트→음성', '자연스러운 음성으로')]),
        ('AI 스튜디오', [('바이럴 스튜디오', '인기 영상 리믹스'), ('AI 드라마', '단편 드라마 제작'),
                      ('말하는 아바타', '아바타가 자연스럽게 말하게'), ('영상 번역', '음성·자막·립싱크 번역')]),
    ],
    'es': [
        ('Herramientas', [('Agente IA', 'Planifica, crea y pule con IA'), ('Guiones', 'Empieza con flujos listos'),
                          ('Lienzo', 'Organiza ideas y reutiliza flujos'), ('Editor de línea', 'Corta, subtitula y termina')]),
        ('Vídeo IA', [('Imagen a vídeo', 'Convierte imágenes en vídeo'), ('Texto a vídeo', 'Genera vídeo desde un prompt'),
                      ('URL a vídeo', 'Convierte una web en vídeo'), ('Vídeo a vídeo', 'Rediseña o edita material'),
                      ('Contenido a vídeo', 'Empieza desde guion, archivo o medio'), ('Mapa de profundidad', 'Convierte vídeo en profundidad')]),
        ('Imagen IA', [('Texto a imagen', 'Crea imágenes desde texto'), ('Imagen a imagen', 'Rediseña o convierte'),
                       ('Quitar fondo', 'Elimina el fondo'), ('Escalar imagen', 'Sube la resolución')]),
        ('Audio IA', [('Música IA', 'Genera música original'), ('Texto a voz', 'Convierte texto en voz natural')]),
        ('Estudio IA', [('Estudio viral', 'Crea y remezcla vídeos top'), ('Drama IA', 'Crea una miniserie'),
                        ('Avatar parlante', 'Haz hablar a tu avatar'), ('Traducir vídeo', 'Traduce voz, subtítulos y labios')]),
    ],
    'fr': [
        ('Outils', [('Agent IA', "Planifie, crée et peaufine"), ('Scripts', 'Démarrez d’un flux existant'),
                    ('Canvas', 'Organisez et réutilisez'), ('Montage', 'Coupez, sous-titrez, terminez')]),
        ('Vidéo IA', [('Image en vidéo', "Transformez l'image en vidéo"), ('Texte en vidéo', 'Générez depuis un prompt'),
                      ('URL en vidéo', 'Convertissez une page web'), ('Vidéo en vidéo', 'Redessinez ou éditez'),
                      ('Contenu en vidéo', 'Partez d’un script ou d’un média'), ('Carte de profondeur', 'Vidéo en profondeur')]),
        ('Image IA', [('Texte en image', 'Créez depuis du texte'), ('Image en image', 'Redessinez ou convertissez'),
                      ('Détourage', 'Supprimez le fond'), ('Upscale', 'Augmentez la résolution')]),
        ('Audio IA', [('Musique IA', 'Générez une musique originale'), ('Synthèse vocale', 'Texte en voix naturelle')]),
        ('Studio IA', [('Studio viral', 'Créez et remixez'), ('Drame IA', 'Créez une mini-série'),
                       ('Avatar parlant', 'Faites parler un avatar'), ('Traduire vidéo', 'Voix, sous-titres, lèvres')]),
    ],
    'de': [
        ('Tools', [('KI-Agent', 'Planen, erstellen, verfeinern'), ('Skripte', 'Mit fertigen Abläufen starten'),
                   ('Canvas', 'Ideen ordnen und wiederverwenden'), ('Timeline-Editor', 'Schneiden, untertiteln, fertig')]),
        ('KI-Video', [('Bild zu Video', 'Bilder zum Leben erwecken'), ('Text zu Video', 'Video aus Prompt'),
                      ('URL zu Video', 'Webseite in Video'), ('Video zu Video', 'Material neu gestalten'),
                      ('Inhalt zu Video', 'Aus Skript, Datei oder Medium'), ('Tiefenkarte', 'Video in Tiefenkarte')]),
        ('KI-Bild', [('Text zu Bild', 'Bilder aus Text'), ('Bild zu Bild', 'Neu gestalten oder umwandeln'),
                     ('Hintergrund entfernen', 'Hintergrund löschen'), ('Bild hochskalieren', 'Höhere Auflösung')]),
        ('KI-Audio', [('KI-Musik', 'Originalmusik erzeugen'), ('Text zu Sprache', 'Natürliche Stimme')]),
        ('KI-Studio', [('Viral-Studio', 'Trends neu mischen'), ('KI-Serie', 'Kurzserie erstellen'),
                       ('Sprechender Avatar', 'Avatar sprechen lassen'), ('Video übersetzen', 'Stimme, Untertitel, Lippen')]),
    ],
    'it': [
        ('Strumenti', [('Agente IA', 'Pianifica, crea, rifinisci'), ('Script', 'Parti da flussi pronti'),
                       ('Canvas', 'Organizza e riusa'), ('Editor timeline', 'Taglia, sottotitola, finisci')]),
        ('Video IA', [('Immagine in video', 'Trasforma le immagini'), ('Testo in video', 'Genera da prompt'),
                      ('URL in video', 'Converti una pagina web'), ('Video in video', 'Ridisegna o modifica'),
                      ('Contenuto in video', 'Da script, file o media'), ('Mappa di profondità', 'Video in profondità')]),
        ('Immagine IA', [('Testo in immagine', 'Crea da testo'), ('Immagine in immagine', 'Ridisegna o converti'),
                         ('Rimuovi sfondo', 'Elimina lo sfondo'), ('Upscale', 'Aumenta la risoluzione')]),
        ('Audio IA', [('Musica IA', 'Genera musica originale'), ('Testo in voce', 'Voce naturale')]),
        ('Studio IA', [('Studio virale', 'Crea e remixa'), ('Drama IA', 'Crea una miniserie'),
                       ('Avatar parlante', 'Fai parlare un avatar'), ('Traduci video', 'Voce, sottotitoli, labiale')]),
    ],
    'pt': [
        ('Ferramentas', [('Agente IA', 'Planeje, crie e refine'), ('Roteiros', 'Comece de fluxos prontos'),
                         ('Canvas', 'Organize e reutilize'), ('Editor de linha', 'Corte, legende, finalize')]),
        ('Vídeo IA', [('Imagem em vídeo', 'Transforme imagens'), ('Texto em vídeo', 'Gere por prompt'),
                      ('URL em vídeo', 'Converta uma página'), ('Vídeo em vídeo', 'Redesenhe ou edite'),
                      ('Conteúdo em vídeo', 'De roteiro, arquivo ou mídia'), ('Mapa de profundidade', 'Vídeo em profundidade')]),
        ('Imagem IA', [('Texto em imagem', 'Crie a partir de texto'), ('Imagem em imagem', 'Redesenhe ou converta'),
                       ('Remover fundo', 'Apague o fundo'), ('Upscale', 'Aumente a resolução')]),
        ('Áudio IA', [('Música IA', 'Gere música original'), ('Texto em fala', 'Voz natural')]),
        ('Estúdio IA', [('Estúdio viral', 'Crie e remixe'), ('Drama IA', 'Crie uma minissérie'),
                        ('Avatar falante', 'Faça o avatar falar'), ('Traduzir vídeo', 'Voz, legendas, lábios')]),
    ],
    'ru': [
        ('Инструменты', [('ИИ-агент', 'Планируй, создавай, дорабатывай'), ('Сценарии', 'Готовые процессы'),
                         ('Холст', 'Соберите и переиспользуйте'), ('Таймлайн', 'Режьте, субтитры, финал')]),
        ('ИИ-видео', [('Фото в видео', 'Оживите изображение'), ('Текст в видео', 'Видео из промпта'),
                      ('URL в видео', 'Страница в видео'), ('Видео в видео', 'Переделать материал'),
                      ('Контент в видео', 'Из сценария, файла, медиа'), ('Карта глубины', 'Видео в глубину')]),
        ('ИИ-изображение', [('Текст в изображение', 'Создайте из текста'), ('Изображение в изображение', 'Переделать'),
                            ('Удалить фон', 'Убрать фон'), ('Апскейл', 'Выше разрешение')]),
        ('ИИ-аудио', [('ИИ-музыка', 'Оригинальная музыка'), ('Текст в речь', 'Естественный голос')]),
        ('ИИ-студия', [('Вирусная студия', 'Создавайте и ремиксуйте'), ('ИИ-сериал', 'Создайте мини-сериал'),
                       ('Говорящий аватар', 'Заставьте аватар говорить'), ('Перевод видео', 'Голос, субтитры, губы')]),
    ],
}

FIELDS = 'mega: { head: string; items: { t: string; d: string }[] }[];'

with open(MAIN, encoding='utf-8') as f:
    t = f.read()
if 'mega: {' not in t:
    t = t.replace('  modelLabel: string;\n}', '  modelLabel: string;\n  ' + FIELDS + '\n}')


def fmt(cols):
    out = ['  mega: [']
    for head, items in cols:
        out.append('    { head: "%s", items: [' % head)
        for it, d in items:
            out.append('      { t: "%s", d: "%s" },' % (it, d))
        out.append('    ] },')
    out.append('  ],')
    return '\n'.join(out)


tz = fmt(MEGA['zh-CN'])
if 'mega: [' not in t:
    t = t.replace('  modelLabel: "模型",\n};', '  modelLabel: "模型",\n' + tz + '\n};')
en = fmt([
    ('Tools', [('AI Agent', 'Plan, create, and refine with AI'), ('Scripts', 'Start from a ready workflow'),
               ('Canvas', 'Organize ideas and reuse workflows'), ('Timeline editor', 'Cut, subtitle, and finish')]),
    ('AI Video', [('Image to video', 'Turn images into motion'), ('Text to video', 'Generate video from a prompt'),
                  ('URL to video', 'Convert a web page into video'), ('Video to video', 'Redesign or enhance footage'),
                  ('Content to video', 'Start from script, file, or media'), ('Video depth map', 'Turn video into depth')]),
    ('AI Image', [('Text to image', 'Create images from text'), ('Image to image', 'Redesign or convert'),
                  ('Background remover', 'Remove any background'), ('Image upscaler', 'Raise the resolution')]),
    ('AI Audio', [('AI Music', 'Generate original music'), ('Text to speech', 'Turn text into natural voice')]),
    ('AI Studio', [('Viral studio', 'Create and remix trending video'), ('AI Drama', 'Build a short drama'),
                   ('Talking avatar', 'Make an avatar speak'), ('Video translate', 'Voice, subs, and lip sync')]),
])
t = t.replace('  modelLabel: "Model",\n};', '  modelLabel: "Model",\n' + en + '\n};')
with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)
print('main mega added')

for loc, cols in MEGA.items():
    p = os.path.join(LOCDIR, loc + '.ts')
    s = open(p, encoding='utf-8').read()
    if 'mega: [' in s:
        print('skip', loc)
        continue
    s = s.replace('  modelLabel: "', fmt(cols) + '\n  modelLabel: "', 1)
    open(p, 'w', encoding='utf-8').write(s)
    print('mega added:', loc)
