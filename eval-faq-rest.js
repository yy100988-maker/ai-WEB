(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const head = [...document.querySelectorAll('h1,h2,h3')].find((h) => (h.textContent || '').includes('常見問答'));
  const scope = head.parentElement;
  const btns = [...scope.querySelectorAll('button')];
  const out = [];
  for (let i = 1; i < btns.length; i++) {
    btns[i].click();
    await sleep(700);
    const t = (scope.innerText || '');
    out.push({ q: btns[i].textContent.trim().slice(0, 40), len: t.length, tail: t.slice(-900) });
  }
  return out;
})()
