(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const btns = [...document.querySelectorAll('aside button')].map((b) => b.textContent.trim());
  out.sidebarButtons = btns;
  const findBtn = (t) => [...document.querySelectorAll('aside button')].find((b) => (b.textContent || '').includes(t));
  const imgBtn = findBtn('AI 圖像');
  if (imgBtn) {
    imgBtn.click();
    await sleep(600);
    const ta = document.querySelector('textarea');
    out.afterImageClick = ta ? ta.placeholder : 'NO_TEXTAREA';
  }
  const canvasBtn = findBtn('畫布');
  if (canvasBtn) {
    canvasBtn.click();
    await sleep(600);
    out.afterCanvasClick = document.body.innerText.includes('把創作過程攤開') ? 'CANVAS_PANEL_OK' : 'MISSING';
  }
  const langBtn = findBtn('語言');
  if (langBtn) {
    langBtn.click();
    await sleep(600);
    out.afterLangClick = document.body.innerText.includes('Português') ? 'LANG_PANEL_OK' : 'MISSING';
  }
  return out;
})()
