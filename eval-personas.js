(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const btns = [...document.querySelectorAll('button')];
  const nextBtn = btns.find((b) => (b.textContent || '').includes('Show next testimonial'));
  const readCard = () => {
    const ps = [...document.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean);
    const names = ['Linda', 'Mia', 'Jesse', 'Lara'];
    for (const n of names) {
      const i = ps.findIndex((t) => t === n);
      if (i >= 0 && !out.some((p) => p.name === n)) {
        out.push({ name: n, role: ps[i + 1] || '', quote: ps.slice(Math.max(0, i - 3), i).find((t) => t.length > 40) || '' });
      }
    }
  };
  readCard();
  for (let k = 0; k < 4 && out.length < 4; k++) {
    if (nextBtn) nextBtn.click();
    await sleep(1500);
    readCard();
  }
  return out;
})()
