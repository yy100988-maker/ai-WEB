import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

# extra fields for the tool-record view
EXTRA = {
    'zh-CN': ('创作纪录', '全部', '视频', '图片', '音频',
        '一段文字或一张参考图，生成你想要的画面。',
        'AI 图像', '使用文字或图片建立或编辑图片', '模型'),
    'ja': ('作成記録', 'すべて', '動画', '画像', '音声',
        'テキストか参考画像から、思い通りの画面を生成。',
        'AI 画像', 'テキストや画像で作成・編集', 'モデル'),
    'ko': ('제작 기록', '전체', '영상', '이미지', '오디오',
        '텍스트나 참조 이미지로 원하는 화면을 생성하세요.',
        'AI 이미지', '텍스트나 이미지로 만들기·편집', '모델'),
    'es': ('Historial', 'Todo', 'Vídeo', 'Imagen', 'Audio',
        'De un texto o una referencia, al visual que quieres.',
        'Imagen IA', 'Crea o edita con texto o imagen', 'Modelo'),
    'fr': ('Historique', 'Tout', 'Vidéo', 'Image', 'Audio',
        "D'un texte ou d'une référence au visuel voulu.",
        'Image IA', 'Créez ou modifiez avec texte ou image', 'Modèle'),
    'de': ('Verlauf', 'Alle', 'Video', 'Bild', 'Audio',
        'Aus Text oder Referenz zum gewünschten Motiv.',
        'KI-Bild', 'Mit Text oder Bild erstellen und bearbeiten', 'Modell'),
    'it': ('Cronologia', 'Tutto', 'Video', 'Immagine', 'Audio',
        'Da un testo o un riferimento al visual che vuoi.',
        'Immagine IA', 'Crea o modifica con testo o immagine', 'Modello'),
    'pt': ('Histórico', 'Tudo', 'Vídeo', 'Imagem', 'Áudio',
        'De um texto ou referência ao visual que você quer.',
        'Imagem IA', 'Crie ou edite com texto ou imagem', 'Modelo'),
    'ru': ('История', 'Все', 'Видео', 'Изображение', 'Аудио',
        'Из текста или референса — нужный визуал.',
        'ИИ-изображение', 'Создавайте текстом или изображением', 'Модель'),
}

FIELDS = ('recordTitle', 'filterAll', 'filterVideo', 'filterImage', 'filterAudio',
          'imageLead', 'imageHero', 'imageComposerPh', 'modelLabel')

with open(MAIN, encoding='utf-8') as f:
    t = f.read()

t = t.replace('  supBody: string;\n}\n\nexport interface PriceTier',
              '  supBody: string;\n' + ''.join('  %s: string;\n' % f for f in FIELDS) + '}\n\nexport interface PriceTier')
t = t.replace('''    supBody: "需要幫助？演示版僅提供佈局還原，不連通客服系統。",''',
              '''    supBody: "需要幫助？演示版僅提供佈局還原，不連通客服系統。",
    recordTitle: "創作紀錄",
    filterAll: "全部",
    filterVideo: "影片",
    filterImage: "圖片",
    filterAudio: "音訊",
    imageLead: "一段文字或一張參考圖，生成你想要的畫面。",
    imageHero: "AI 圖像",
    imageComposerPh: "使用文字或圖片建立或編輯圖片",
    modelLabel: "模型",''')
t = t.replace('''    supBody: "Need help? The demo only replicates layout, no live support.",''',
              '''    supBody: "Need help? The demo only replicates layout, no live support.",
    recordTitle: "Creation log",
    filterAll: "All",
    filterVideo: "Video",
    filterImage: "Image",
    filterAudio: "Audio",
    imageLead: "From a prompt or a reference image to the visual you want.",
    imageHero: "AI Image",
    imageComposerPh: "Create or edit images with text or images",
    modelLabel: "Model",''')

with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)
print('main fields added')

for loc, vals in EXTRA.items():
    p = os.path.join(LOCDIR, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        s = f.read()
    anchor = '    supBody: "'
    i = s.find(anchor)
    assert i > 0, loc
    end = s.find('",', i)
    block = ''.join('\n    %s: "%s",' % (f, v) for f, v in zip(FIELDS, vals))
    s = s[:end + 2] + block + s[end + 2:]
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)
    print('extra added:', loc)
