(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { personas: [], faqText: '' };

  const btns = [...document.querySelectorAll('button')];
  const nextBtn = btns.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('next testimonial'))
    || btns.find((b) => (b.textContent || '').includes('Show next testimonial'));

  const readCard = () => {
    const ps = [...document.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean);
    const names = ['Linda', 'Mia', 'Jesse', 'Lara'];
    for (const n of names) {
      const i = ps.findIndex((t) => t === n);
      if (i >= 0 && !out.personas.some((p) => p.name === n)) {
        out.personas.push({
          name: n,
          role: ps[i + 1] || '',
          quote: ps.slice(Math.max(0, i - 3), i).find((t) => t.length > 40) || ''
        });
      }
    }
  };

  readCard();
  for (let k = 0; k < 4; k++) {
    if (nextBtn) nextBtn.click();
    await sleep(1200);
    readCard();
  }

  const faqBtns = btns.filter((b) => /差別|自訂|免費試用|開始使用|商業用途/.test(b.textContent || ''));
  for (const b of faqBtns) { b.click(); await sleep(400); }

  const faqHead = [...document.querySelectorAll('h1,h2,h3')].find((h) => (h.textContent || '').includes('常見問答'));
  if (faqHead) {
    let node = faqHead.parentElement;
    out.faqText = (node ? node.innerText : '').slice(0, 3000);
  }
  return out;
})()
