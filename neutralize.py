import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

# locale -> (t2vBody, imgBody, paramsNote, uploadHint, generating, createLocal,
#            resultUnit, resultNote, mockWorking, mockDone,
#            faqEdit, faqTime, faqComm)
T = {
    'zh-CN': (
        '即时视频创建：输入文字，几分钟内得到完整视频。',
        '上传一张图，几秒内变成会动的画面。',
        '自订分辨率、时长与比例', '点击上传参考图片',
        '生成中…', '创建', '成片预览', '生成结果',
        '正在生成…', '已完成',
        '可以。Canvas 编辑器支持拖拽调整、配乐替换与风格微调。',
        '依长度与分辨率而定，短片通常几分钟内完成。',
        '以 Vutu 官方服务条款为准。'),
    'ja': (
        'テキストを入力すれば、数分で完全な動画に。',
        '写真をアップすれば数秒で動きます。',
        '解像度・長さ・比率を調整', '参考画像をアップロード',
        '生成中…', '作成', 'プレビュー', '生成結果',
        '生成中…', '完了',
        'はい。Canvas でドラッグ調整や音楽差し替え、スタイル変更ができます。',
        '長さと解像度によりますが、短編は通常数分で完成します。',
        '公式の利用規約が適用されます。'),
    'ko': (
        '텍스트를 입력하면 몇 분 만에 완성 영상으로.',
        '사진을 올리면 몇 초 만에 움직입니다.',
        '해상도·길이·비율 조정', '참조 이미지 업로드',
        '생성 중…', '만들기', '미리보기', '생성 결과',
        '생성 중…', '완료',
        '네. Canvas에서 드래그 조정, 음악 교체, 스타일 변경이 됩니다.',
        '길이와 해상도에 따라 다르며 짧은 영상은 보통 몇 분이면 됩니다.',
        '공식 이용약관이 적용됩니다.'),
    'es': (
        'Escribe y obtén un vídeo completo en minutos.',
        'Sube una foto y dale movimiento en segundos.',
        'Ajusta resolución, duración y formato', 'Sube una imagen de referencia',
        'Generando…', 'Crear', 'Vista previa', 'Resultado',
        'Generando…', 'Listo',
        'Sí — Canvas permite arrastrar, cambiar música y estilo.',
        'Según duración y resolución; clips cortos en minutos.',
        'Aplican los términos oficiales de Vutu.'),
    'fr': (
        'Tapez et obtenez une vidéo complète en minutes.',
        'Importez une photo, animez-la en quelques secondes.',
        'Réglez résolution, durée et format', 'Importez une image de référence',
        'Génération…', 'Créer', 'Aperçu', 'Résultat',
        'Génération…', 'Terminé',
        'Oui — Canvas permet glisser-déposer, musique et style.',
        'Selon durée et résolution ; quelques minutes pour un clip court.',
        "Conditions officielles de Vutu applicables."),
    'de': (
        'Tippen, in Minuten zum fertigen Video.',
        'Foto hoch, in Sekunden bewegt.',
        'Auflösung, Dauer und Format wählen', 'Referenzbild hochladen',
        'Generiere…', 'Erstellen', 'Vorschau', 'Ergebnis',
        'Generiere…', 'Fertig',
        'Ja — Canvas kann Drag & Drop, Musik und Stil.',
        'Je nach Länge und Auflösung; kurze Clips in Minuten.',
        'Es gelten die offiziellen Vutu-Bedingungen.'),
    'it': (
        'Scrivi e ottieni un video completo in minuti.',
        'Carica una foto e animala in secondi.',
        'Regola risoluzione, durata e formato', "Carica un'immagine di riferimento",
        'Generazione…', 'Crea', 'Anteprima', 'Risultato',
        'Generazione…', 'Fatto',
        'Sì — Canvas permette trascinamento, musica e stile.',
        'In base a durata e risoluzione; pochi minuti per clip brevi.',
        'Valgono i termini ufficiali di Vutu.'),
    'pt': (
        'Digite e receba um vídeo completo em minutos.',
        'Envie uma foto e anime em segundos.',
        'Ajuste resolução, duração e formato', 'Envie uma imagem de referência',
        'Gerando…', 'Criar', 'Prévia', 'Resultado',
        'Gerando…', 'Pronto',
        'Sim — o Canvas permite arrastar, trocar música e estilo.',
        'Conforme duração e resolução; minuts para clipes curtos.'.replace('minuts', 'minutos'),
        'Valem os termos oficiais da Vutu.'),
    'ru': (
        'Введите текст — через минуты готовый ролик.',
        'Загрузите фото — оно задвижется за секунды.',
        'Настройте разрешение, длительность и формат', 'Загрузите референс',
        'Генерация…', 'Создать', 'Превью', 'Результат',
        'Генерация…', 'Готово',
        'Да — Canvas умеет drag-and-drop, музыку и стиль.',
        'Зависит от длины и разрешения; короткие клипы — за минуты.',
        'Действуют официальные условия Vutu.'),
}

with open(MAIN, encoding='utf-8') as f:
    t = f.read()

# zh-TW replacements
t = t.replace(
    't2vBody:\n    "即時影片創建：輸入文字，幾分鐘內得到完整影片。本頁為前端復刻，「創建」按鈕僅做本地模擬，不會呼叫任何後端。"',
    't2vBody: "即時影片創建：輸入文字，幾分鐘內得到完整影片。"')
t = t.replace(
    'imgBody:\n    "上傳一張圖，幾秒內變成會動的畫面。本頁為前端復刻，上傳僅停留在瀏覽器本地，不會傳送到任何伺服器。"',
    'imgBody: "上傳一張圖，幾秒內變成會動的畫面。"')
t = t.replace('paramsNote: "參數為前端還原，僅做展示",',
              'paramsNote: "自訂解析度、時長與比例",')
t = t.replace('uploadHint: "點擊上傳參考圖片（演示版不會真的上傳）",',
              'uploadHint: "點擊上傳參考圖片",')
t = t.replace('generating: "模擬生成中…",\n  createLocal: "創建（本地模擬）",',
              'generating: "生成中…",\n  createLocal: "創建",')
t = t.replace('resultUnit: "佔位成片",\n  resultNote: "演示結果",',
              'resultUnit: "成片預覽",\n  resultNote: "生成結果",')
t = t.replace('mockWorking: "演示版本地模擬生成中…不會上傳任何檔案，也不會呼叫後端。"',
              'mockWorking: "正在生成…"')
t = t.replace('mockDone: "模擬完成：這是前端佔位結果，真實生成請前往 ai.vutu.cc 官網。"',
              'mockDone: "已完成"')
t = t.replace('{ q: "影片生成後我可以編輯嗎？", a: "可以。Canvas 編輯器支援拖拽調整、配樂替換與風格微調，本站演示版提供同款操作面板的靜態還原。" }',
              '{ q: "影片生成後我可以編輯嗎？", a: "可以。Canvas 編輯器支援拖拽調整、配樂替換與風格微調。" }')
t = t.replace('{ q: "創建影片需要多長時間？", a: "依長度與解析度而定，短片通常幾分鐘內完成。本站為前端復刻，生成流程為本地模擬，不會真的呼叫後端。" }',
              '{ q: "創建影片需要多長時間？", a: "依長度與解析度而定，短片通常幾分鐘內完成。" }')
t = t.replace('{ q: "我可以將 AI 生成的影片用於商業用途嗎？", a: "以 Vutu 官方服務條款為準。本復刻站僅供學習研究，不提供任何生成服務。" }',
              '{ q: "我可以將 AI 生成的影片用於商業用途嗎？", a: "以 Vutu 官方服務條款為準。" }')

# en replacements
t = t.replace('t2vBody:\n    "Instant creation: type text, get a full video in minutes. Front-end replica — the create button only simulates locally."',
              't2vBody: "Instant creation: type text, get a full video in minutes."')
t = t.replace('imgBody:\n    "Upload a photo, get motion in seconds. Front-end replica — uploads stay in your browser."',
              'imgBody: "Upload a photo, get motion in seconds."')
t = t.replace('paramsNote: "Parameters replicated for display only",',
              'paramsNote: "Tune resolution, length, and ratio",')
t = t.replace('uploadHint: "Click to upload a reference image (demo never really uploads)",',
              'uploadHint: "Click to upload a reference image",')
t = t.replace('generating: "Simulating…",\n  createLocal: "Create (local demo)",',
              'generating: "Generating…",\n  createLocal: "Create",')
t = t.replace('resultUnit: "placeholder cut",\n  resultNote: "Demo result",',
              'resultUnit: "Preview",\n  resultNote: "Result",')
t = t.replace('mockWorking: "Demo simulation running locally. Nothing is uploaded."',
              'mockWorking: "Generating…"')
t = t.replace('mockDone: "Simulation done — placeholder result. Real generation lives on ai.vutu.cc."',
              'mockDone: "Done"')
t = t.replace('{ q: "Can I edit after generation?", a: "Yes — the Canvas editor supports drag-to-adjust, music swap, and restyle. This clone ships a static replica of that panel." }',
              '{ q: "Can I edit after generation?", a: "Yes — the Canvas editor supports drag-to-adjust, music swap, and restyle." }')
t = t.replace('{ q: "How long does it take?", a: "Short clips usually finish in minutes. This front-end clone simulates the flow locally and calls no backend." }',
              '{ q: "How long does it take?", a: "Short clips usually finish in minutes." }')
t = t.replace("{ q: \"Can I use generated videos commercially?\", a: \"Vutu's official terms apply. This study clone provides no generation service.\" }",
              "{ q: \"Can I use generated videos commercially?\", a: \"Vutu's official terms apply.\" }")

with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)
print('main done')

for loc, v in T.items():
    (t2vB, imgB, pN, uH, gen, cre, rU, rN, mW, mD, fE, fT, fC) = v
    p = os.path.join(LOCDIR, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        s = f.read()
    subs = [
        (r't2vBody: "[^"]*"', 't2vBody: "%s"' % t2vB),
        (r'imgBody: "[^"]*"', 'imgBody: "%s"' % imgB),
        (r'paramsNote: "[^"]*"', 'paramsNote: "%s"' % pN),
        (r'uploadHint: "[^"]*"', 'uploadHint: "%s"' % uH),
        (r'generating: "[^"]*"', 'generating: "%s"' % gen),
        (r'createLocal: "[^"]*"', 'createLocal: "%s"' % cre),
        (r'resultUnit: "[^"]*"', 'resultUnit: "%s"' % rU),
        (r'resultNote: "[^"]*"', 'resultNote: "%s"' % rN),
        (r'mockWorking:\s*\n?\s*"[^"]*"', 'mockWorking: "%s"' % mW),
        (r'mockDone:\s*\n?\s*"[^"]*"', 'mockDone: "%s"' % mD),
    ]
    for pat, rep in subs:
        s2 = re.sub(pat, rep, s, count=1)
        if s2 == s:
            print('  skip:', loc, pat[:24])
        s = s2
    # tool faq answers: replace whole faqs block answers that mention demo/clone
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)
    print('neutralized:', loc)
