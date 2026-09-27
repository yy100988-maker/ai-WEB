(async () => {
  const out = { dropdowns: 0, items: [], appHrefs: [] };
  const groups = [...document.querySelectorAll('nav > div.group')];
  out.dropdowns = groups.length;
  for (const g of groups) {
    const trigger = g.querySelector('a');
    const label = trigger ? trigger.textContent.trim() : '';
    const menu = g.querySelector('div.absolute');
    if (menu) {
      out.items.push({
        menu: label,
        items: [...menu.querySelectorAll('a')].map((a) => a.textContent.trim()),
      });
    }
  }
  const all = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
  out.appHrefs = [...new Set(all.filter((h) => h.indexOf('/app') !== -1))];
  return out;
})()
