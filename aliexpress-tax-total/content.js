function parseMoney(text) {
  if (!text) return null;
  const match = text.match(/R\$\s*([\d.]+(?:,\d+)?)/i);
  if (!match) return null;

  const cleanNumber = match[1].replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleanNumber);
  return isNaN(val) ? null : val;
}

function parseAllMoney(text) {
  if (!text) return [];
  const values = [];
  const re = /R\$\s*([\d.]+(?:,\d+)?)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(val)) {
      values.push({ val, index: match.index, raw: match[0] });
    }
  }
  return values;
}

function formatMoney(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isOurBadge(el) {
  return el && (el.id === 'ali-custom-tax-total' || el.closest?.('#ali-custom-tax-total'));
}

function findTaxElement() {
  const candidates = Array.from(document.querySelectorAll('span, div, p, strong, em, b, label, li'))
    .filter((el) => {
      if (isOurBadge(el)) return false;
      const text = el.textContent || '';
      // Linha típica: "International purchase, +R$673,62 estimated tax"
      const hasTaxLabel = /estimated\s*tax|imposto/i.test(text);
      const hasMoney = /R\$\s*[\d.,]+/.test(text);
      return hasTaxLabel && hasMoney;
    });

  if (candidates.length === 0) return null;

  // Menor texto = nó mais específico (evita containers enormes)
  candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
  return candidates[0];
}

function isStrikethroughPrice(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.closest('del, s, strike')) return true;

  let node = el;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.textDecorationLine.includes('line-through') || style.textDecoration.includes('line-through')) {
      return true;
    }
  }
  return false;
}

function findItemPrice(taxElement, taxValue) {
  // Busca preços reais no bloco (ignora preço riscado / "de")
  let container = taxElement.parentElement;
  for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
    if (isOurBadge(container)) continue;
    if (!/estimated\s*tax|imposto/i.test(container.textContent || '')) continue;

    const priceCandidates = Array.from(container.querySelectorAll('span, div, strong, b, em'))
      .filter((el) => {
        if (isOurBadge(el) || el === taxElement || taxElement.contains(el)) return false;
        if (isStrikethroughPrice(el)) return false;
        if ((el.textContent || '').length > 32) return false;
        if (!/R\$\s*[\d.,]+/.test(el.textContent || '')) return false;
        // Precisa preceder o imposto no DOM
        return !!(taxElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
      })
      .map((el) => ({ el, val: parseMoney(el.textContent) }))
      .filter((item) => item.val != null && Math.abs(item.val - taxValue) > 0.001);

    if (priceCandidates.length > 0) {
      // No AliExpress: preço atual primeiro, depois % off e preço riscado.
      // Com riscado filtrado, o primeiro candidato é o preço vigente.
      return priceCandidates[0].val;
    }
  }

  // Fallback por texto: primeiro R$ antes do rótulo de imposto (não o último = riscado)
  container = taxElement.parentElement;
  for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
    const text = container.textContent || '';
    const taxLabelMatch = text.match(/estimated\s*tax|imposto/i);
    if (!taxLabelMatch) continue;

    const beforeTax = parseAllMoney(text).filter(
      (a) => a.index < taxLabelMatch.index && Math.abs(a.val - taxValue) > 0.001
    );
    if (beforeTax.length > 0) return beforeTax[0].val;
  }

  return null;
}

function calculateAndInjectTotal() {
  const existingBadge = document.getElementById('ali-custom-tax-total');

  const taxElement = findTaxElement();
  if (!taxElement) {
    if (existingBadge) existingBadge.remove();
    return;
  }

  const taxValue = parseMoney(taxElement.textContent);
  if (taxValue == null) return;

  const itemPrice = findItemPrice(taxElement, taxValue);
  if (itemPrice == null) return;

  const total = itemPrice + taxValue;
  const totalFormatted = formatMoney(total);
  const label = `Total (Produto + Imposto): ${totalFormatted}`;

  if (existingBadge) {
    if (existingBadge.getAttribute('data-total') === totalFormatted) return;
    existingBadge.textContent = label;
    existingBadge.setAttribute('data-total', totalFormatted);
    return;
  }

  const badge = document.createElement('div');
  badge.id = 'ali-custom-tax-total';
  badge.setAttribute('data-total', totalFormatted);
  badge.textContent = label;
  badge.style.cssText = `
    display: block;
    margin-top: 6px;
    margin-bottom: 6px;
    padding: 6px 10px;
    background: #fdf2f2;
    border: 1px solid #f98888;
    border-radius: 6px;
    color: #e52e04;
    font-size: 15px;
    font-weight: bold;
    width: fit-content;
  `;

  taxElement.insertAdjacentElement('afterend', badge);
}

function start() {
  if (!document.body) {
    setTimeout(start, 100);
    return;
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(calculateAndInjectTotal, 250);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  calculateAndInjectTotal();
  // AliExpress renderiza preço/imposto de forma assíncrona
  setTimeout(calculateAndInjectTotal, 1000);
  setTimeout(calculateAndInjectTotal, 3000);
}

start();
