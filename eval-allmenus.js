(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const nav = document.querySelector('nav');
  const btns = [...nav.querySelectorAll('button')].filter((b) => b.hasAttribute('aria-expanded'));
  for (const b of btns) {
    const label = b.textContent.trim();
    b.click();
    await sleep(400);
    const panel = document.querySelector('div.absolute.inset-x-0');
    const heads = panel ? [...panel.querySelectorAll('.grid > div > p')].map((p) => p.textContent.trim()) : [];
    const firsts = panel ? [...panel.querySelectorAll('.grid > div a p:first-child')].map((p) => p.textContent.trim()).slice(0, 3) : [];
    out.push({ menu: label, heads, sample: firsts });
    b.click();
    await sleep(250);
  }
  return out;
})()
