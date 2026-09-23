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
      const hasTaxLabel = /estimated\s*tax|imposto/i.test(text);
      const hasMoney = /R\$\s*[\d.,]+/.test(text);
      return hasTaxLabel && hasMoney;
    });

  if (candidates.length === 0) return null;

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
        return !!(taxElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
      })
      .map((el) => ({ el, val: parseMoney(el.textContent) }))
      .filter((item) => item.val != null && Math.abs(item.val - taxValue) > 0.001);

    if (priceCandidates.length > 0) {
      return priceCandidates[0].val;
    }
  }

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

function findShippingPrice(itemPrice, taxValue) {
  const shippingLabel = /ship\s*from|shipping|frete|envio|standard\s*:|entrega|delivery|economia|AliExpress\s*Saver/i;
  const freeShipping = /free\s*shipping|frete\s*gr[aá]tis|envio\s*gr[aá]tis|gr[aá]tis/i;

  const candidates = Array.from(document.querySelectorAll('span, div, p, strong, b, li, a'))
    .filter((el) => {
      if (isOurBadge(el)) return false;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 160) return false;
      if (!shippingLabel.test(text) && !freeShipping.test(text)) return false;
      // Evita a linha de imposto
      if (/estimated\s*tax|imposto/i.test(text)) return false;
      return /R\$\s*[\d.,]+/.test(text) || freeShipping.test(text);
    });

  if (candidates.length === 0) return { value: 0, found: false };

  candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);

  for (const el of candidates) {
    const text = el.textContent || '';
    if (freeShipping.test(text) && !/R\$\s*[\d.,]+/.test(text)) {
      return { value: 0, found: true };
    }

    const amounts = parseAllMoney(text)
      .map((a) => a.val)
      .filter(
        (val) =>
          Math.abs(val - itemPrice) > 0.001 &&
          Math.abs(val - taxValue) > 0.001
      );

    if (amounts.length > 0) {
      return { value: amounts[0], found: true };
    }
  }

  return { value: 0, found: false };
}

function buildBadgeContent(itemPrice, taxValue, shipping) {
  const shippingValue = shipping.found ? shipping.value : 0;
  const total = itemPrice + taxValue + shippingValue;

  const shippingLine = shipping.found
    ? `Frete: ${shippingValue === 0 ? 'Grátis' : formatMoney(shippingValue)}`
    : 'Frete: —';

  return {
    total,
    totalFormatted: formatMoney(total),
    html: `
      <div style="font-size:12px;font-weight:600;opacity:.85;margin-bottom:4px;">Resumo do custo</div>
      <div style="font-size:13px;font-weight:500;line-height:1.45;">
        Produto: ${formatMoney(itemPrice)}<br>
        Imposto: ${formatMoney(taxValue)}<br>
        ${shippingLine}
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f98888;font-size:15px;font-weight:bold;">
        Total: ${formatMoney(total)}
      </div>
    `.trim(),
    signature: `${itemPrice}|${taxValue}|${shipping.found ? shippingValue : 'na'}`
  };
}

function applyBadgeStyles(badge) {
  badge.style.cssText = `
    display: block;
    margin-top: 8px;
    margin-bottom: 8px;
    padding: 8px 12px;
    background: #fdf2f2;
    border: 1px solid #f98888;
    border-radius: 6px;
    color: #e52e04;
    width: fit-content;
    max-width: 320px;
    box-sizing: border-box;
  `;
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

  const shipping = findShippingPrice(itemPrice, taxValue);
  const content = buildBadgeContent(itemPrice, taxValue, shipping);

  if (existingBadge) {
    if (existingBadge.getAttribute('data-total') === content.signature) return;
    existingBadge.innerHTML = content.html;
    existingBadge.setAttribute('data-total', content.signature);
    return;
  }

  const badge = document.createElement('div');
  badge.id = 'ali-custom-tax-total';
  badge.setAttribute('data-total', content.signature);
  badge.innerHTML = content.html;
  applyBadgeStyles(badge);

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
  setTimeout(calculateAndInjectTotal, 1000);
  setTimeout(calculateAndInjectTotal, 3000);
}

start();
