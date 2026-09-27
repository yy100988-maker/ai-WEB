(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const btns = [...document.querySelectorAll('button')];
  const faqBtns = btns.filter((b) => /差別|自訂|免費試用|開始使用|商業用途/.test(b.textContent || ''));
  for (const b of faqBtns) {
    const q = (b.textContent || '').trim().slice(0, 60);
    b.click();
    await sleep(600);
    let a = '';
    let node = b.parentElement;
    for (let d = 0; d < 3 && node; d++) {
      const t = (node.innerText || '').trim();
      if (t.length > q.length + 20) { a = t.slice(q.length).trim().slice(0, 500); break; }
      node = node.parentElement;
    }
    out.push({ q, a });
    b.click();
    await sleep(300);
  }
  return out;
})()
