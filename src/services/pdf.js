import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatCurrency } from '../utils/formatters';

/**
 * Build a print-ready HTML document for a quote and hand it to expo-print.
 * Returns the file URI of the generated PDF.
 */
export async function generateQuotePdf(quote) {
  const html = buildHtml(quote);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}

export async function shareQuotePdf(quote) {
  const uri = await generateQuotePdf(quote);
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Send quote',
    UTI: 'com.adobe.pdf',
  });
  return uri;
}

// HTML template

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(quote) {
  const ai = quote.ai || {};
  const biz = quote.businessName || 'Your tradesperson';
  const dateStr = new Date(quote.createdAt || Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const total = quote.edits?.total ?? ai.total ?? 0;
  const customerNotes = quote.edits?.notes;

  const lineRows = (ai.line_items || []).map((li) => `
    <tr>
      <td>
        <div class="desc">${esc(li.description)}</div>
        <div class="meta">${esc(li.qty)} ${esc(li.unit || '')} × ${esc(formatCurrency(li.unit_price))}</div>
      </td>
      <td class="money">${esc(formatCurrency(li.total))}</td>
    </tr>
  `).join('');

  const upsellBlock = (ai.upsells || []).length
    ? `
    <div class="section">
      <h3>Optional extras</h3>
      ${ai.upsells.map((u) => `
        <div class="upsell">
          <div class="upsellMain">
            <div class="upsellTitle">${esc(u.title)}</div>
            <div class="upsellWhy">${esc(u.why)}</div>
          </div>
          <div class="money">${esc(formatCurrency(u.price))}</div>
        </div>
      `).join('')}
    </div>`
    : '';

  const customerLine = quote.customer?.name
    ? `<div class="for">For: <strong>${esc(quote.customer.name)}</strong></div>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 40px 36px; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #1A1F26;
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 18px;
      border-bottom: 3px solid #0F2C4A;
      margin-bottom: 22px;
    }
    .brand { font-size: 24px; font-weight: 800; color: #0F2C4A; letter-spacing: -0.3px; }
    .biz { font-size: 13px; color: #3D4653; margin-top: 4px; }
    .meta { text-align: right; font-size: 12px; color: #6B7280; }
    .meta .label { font-weight: 700; color: #3D4653; }

    .for { font-size: 14px; color: #3D4653; margin-bottom: 14px; }

    .section { margin-bottom: 22px; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.8px; color: #6B7280; margin: 0 0 8px 0; font-weight: 700; }
    h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.8px; color: #6B7280; margin: 0 0 8px 0; font-weight: 700; }

    .summary { font-size: 17px; font-weight: 600; color: #0F2C4A; margin: 0 0 10px 0; line-height: 1.35; }
    .diagnosis { background: #E8F1FD; padding: 12px 14px; border-radius: 6px; color: #0F2C4A; }

    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #6B7280; padding: 8px 0; border-bottom: 1px solid #E2E7EF; }
    td { padding: 10px 0; border-bottom: 1px solid #EEF1F6; vertical-align: top; }
    td.money { text-align: right; font-weight: 700; color: #0F2C4A; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 12px; }
    .desc { font-weight: 600; color: #1A1F26; }
    td .meta { font-size: 11px; color: #6B7280; margin-top: 2px; font-weight: 500; }

    .totals { margin-top: 10px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #3D4653; }
    .totals .grand { border-top: 2px solid #0F2C4A; margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 800; color: #0F2C4A; }

    .upsell { display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #EEF1F6; }
    .upsellMain { flex: 1; padding-right: 12px; }
    .upsellTitle { font-weight: 700; color: #0F2C4A; }
    .upsellWhy { font-size: 12px; color: #6B7280; margin-top: 2px; }

    .notes { background: #F4F6F9; padding: 12px 14px; border-radius: 6px; font-size: 13px; color: #3D4653; }

    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid #E2E7EF;
      font-size: 10px;
      color: #6B7280;
      line-height: 1.5;
    }
    .chip {
      display: inline-block;
      background: #EEF1F6;
      color: #3D4653;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-right: 6px;
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="brand">${esc(biz)}</div>
      <div class="biz">Quotation</div>
    </div>
    <div class="meta">
      <div><span class="label">Date:</span> ${esc(dateStr)}</div>
      <div><span class="label">Ref:</span> ${esc((quote.id || '').replace('q_', '#'))}</div>
    </div>
  </div>

  ${customerLine}

  <div class="section">
    <h2>Summary</h2>
    <p class="summary">${esc(ai.customer_summary || '')}</p>
    <div>
      ${ai.estimated_duration ? `<span class="chip">⏱ ${esc(ai.estimated_duration)}</span>` : ''}
      ${ai.labour_hours ? `<span class="chip">${esc(ai.labour_hours)}h labour</span>` : ''}
    </div>
  </div>

  ${ai.diagnosis ? `
  <div class="section">
    <h2>On-site diagnosis</h2>
    <div class="diagnosis">${esc(ai.diagnosis)}</div>
  </div>` : ''}

  <div class="section">
    <h2>Quote breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>
    <div class="totals">
      ${ai.vat && ai.vat > 0 ? `
        <div class="row"><span>Subtotal</span><span>${esc(formatCurrency(ai.subtotal))}</span></div>
        <div class="row"><span>VAT</span><span>${esc(formatCurrency(ai.vat))}</span></div>
      ` : ''}
      <div class="row grand"><span>Total</span><span>${esc(formatCurrency(total))}</span></div>
    </div>
  </div>

  ${upsellBlock}

  ${customerNotes ? `
  <div class="section">
    <h2>Notes</h2>
    <div class="notes">${esc(customerNotes)}</div>
  </div>` : ''}

  <div class="footer">
    Generated with OnQuote. Prices valid for 14 days from the date above. Final cost may vary if on-site conditions differ from the photographs provided.
  </div>

</body>
</html>`;
}
