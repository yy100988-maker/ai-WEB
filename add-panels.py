import os
import re

BASE = r'D:\CODEX\WEB\ai-cloner\src\components\sites\vutu'
MAIN = os.path.join(BASE, 'site-data.ts')
LOCDIR = os.path.join(BASE, 'locales')

# (audioPh, canvasCap, edCap, edTrack, trTitle, trBtn, supTitle, supBody)
S = {
    'zh-CN': ('描述你想要的声音、音乐或配音…', '画布：把创作过程摊开，每一步都可单独调整',
        '编辑器：时间线', '轨道', '影片翻译', '开始翻译（演示）',
        '支援', '需要帮助？演示版仅提供布局还原，不连通客服系统。'),
    'ja': ('作りたい音・音楽・ナレーションを記述…', 'キャンバス：工程を広げ、各 step を個別に調整',
        'エディター：タイムライン', 'トラック', '動画翻訳', '翻訳開始（デモ）',
        'サポート', 'お困りですか？デモはレイアウト再現のみで、窓口には繋がりません。'),
    'ko': ('원하는 소리, 음악, 내레이션을 서술…', '캔버스: 과정을 펼쳐 각 단계 개별 조정',
        '에디터: 타임라인', '트랙', '영상 번역', '번역 시작(데모)',
        '지원', '도움이 필요하신가요? 데모는 레이아웃 재현만 하며 고객센터와 연결되지 않습니다.'),
    'es': ('Describe el sonido, música o voz…', 'Lienzo: despliega el proceso, ajusta cada paso',
        'Editor: línea de tiempo', 'Pista', 'Traducir vídeo', 'Traducir (demo)',
        'Soporte', '¿Ayuda? La demo solo replica el diseño, sin contacto real.'),
    'fr': ('Décrivez son, musique ou voix…', 'Canvas : déplie le processus, réglez chaque étape',
        'Éditeur : timeline', 'Piste', 'Traduire la vidéo', 'Traduire (démo)',
        'Support', "Besoin d'aide ? La démo ne fait que le design, sans vrai contact."),
    'de': ('Sound, Musik oder Stimme beschreiben…', 'Canvas: Prozess ausbreiten, jeden Schritt einzeln regeln',
        'Editor: Timeline', 'Spur', 'Video übersetzen', 'Übersetzen (Demo)',
        'Support', 'Hilfe? Das Demo bildet nur das Layout nach, ohne echten Kontakt.'),
    'it': ('Descrivi suono, musica o voce…', 'Canvas: apri il processo, regola ogni passo',
        'Editor: timeline', 'Traccia', 'Traduci video', 'Traduci (demo)',
        'Supporto', 'Aiuto? La demo replica solo il design, senza contatti veri.'),
    'pt': ('Descreva som, música ou voz…', 'Canvas: abre o processo, ajuste cada etapa',
        'Editor: linha do tempo', 'Faixa', 'Traduzir vídeo', 'Traduzir (demo)',
        'Suporte', 'Ajuda? A demo só replica o design, sem contato real.'),
    'ru': ('Опишите звук, музыку или голос…', 'Холст: разложите процесс, настройте каждый шаг',
        'Редактор: таймлайн', 'Дорожка', 'Перевод видео', 'Перевести (демо)',
        'Поддержка', 'Нужна помощь? Демо лишь повторяет вёрстку, без реальной связи.'),
}

with open(MAIN, encoding='utf-8') as f:
    t = f.read()
t = t.replace('  backV1: string;\n  trial: string;\n}',
              '  backV1: string;\n  trial: string;\n  audioPh: string;\n  canvasCap: string;\n  edCap: string;\n  edTrack: string;\n  trTitle: string;\n  trBtn: string;\n  supTitle: string;\n  supBody: string;\n}')
t = t.replace('''    inspTitle: "靈感",
    backV1: "Vutu 1.0",''', '''    inspTitle: "靈感",
    backV1: "Vutu 1.0",
    audioPh: "描述你想要的聲音、音樂或旁白…",
    canvasCap: "畫布：把創作過程攤開，每一步都可單獨調整",
    edCap: "編輯器：時間線",
    edTrack: "軌道",
    trTitle: "影片翻譯",
    trBtn: "開始翻譯（演示）",
    supTitle: "支援",
    supBody: "需要幫助？演示版僅提供佈局還原，不連通客服系統。",''')
t = t.replace('''    inspTitle: "Inspiration",
    backV1: "Vutu 1.0",''', '''    inspTitle: "Inspiration",
    backV1: "Vutu 1.0",
    audioPh: "Describe the sound, music, or voice-over…",
    canvasCap: "Canvas: unfold the process, tune each step",
    edCap: "Editor: timeline",
    edTrack: "Track",
    trTitle: "Video translate",
    trBtn: "Translate (demo)",
    supTitle: "Support",
    supBody: "Need help? The demo only replicates layout, no live support.",''')
with open(MAIN, 'w', encoding='utf-8') as f:
    f.write(t)

for loc, v in S.items():
    p = os.path.join(LOCDIR, loc + '.ts')
    with open(p, encoding='utf-8') as f:
        s = f.read()
    pat = re.compile(r'(    inspTitle: "[^"]*",\n    backV1: "Vutu 1\.0",)')
    block = ('\\1\n    audioPh: "%s",\n    canvasCap: "%s",\n    edCap: "%s",\n'
             '    edTrack: "%s",\n    trTitle: "%s",\n    trBtn: "%s",\n'
             '    supTitle: "%s",\n    supBody: "%s",') % v
    s2, n = pat.subn(block, s, count=1)
    assert n == 1, loc
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s2)
    print('panel strings added:', loc)
