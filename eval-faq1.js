(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const head = [...document.querySelectorAll('h1,h2,h3')].find((h) => (h.textContent || '').includes('常見問答'));
  if (!head) return { err: 'no faq heading' };
  const scope = head.parentElement;
  const btns = [...scope.querySelectorAll('button')];
  const first = btns[0];
  if (!first) return { err: 'no buttons' };
  first.click();
  await sleep(800);
  const t = (scope.innerText || '').slice(0, 1200);
  return { q: first.textContent.trim().slice(0, 60), text: t };
})()
