(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const btn = [...document.querySelectorAll('nav button')].find(
    (b) => b.textContent.trim().startsWith('创作') || b.textContent.trim().startsWith('創作'),
  );
  out.found = !!btn;
  if (!btn) return out;

  btn.click();
  await sleep(500);
  const panel = document.querySelector('div.absolute.inset-x-0');
  out.opened = !!panel;
  if (panel) {
    out.columns = [...panel.querySelectorAll('.grid > div')].map((c) => {
      const head = c.querySelector('p');
      const items = [...c.querySelectorAll('a p:first-child')].map((p) => p.textContent.trim());
      return { head: head ? head.textContent.trim() : '', items };
    });
    out.backdrop = !!document.querySelector('div.fixed.inset-0');
  }

  btn.click();
  await sleep(500);
  out.closed = !document.querySelector('div.absolute.inset-x-0');
  return out;
})()
