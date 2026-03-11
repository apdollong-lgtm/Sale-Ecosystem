const SHEETS = {
  LEADS: 'Leads',
  DEALS: 'Deals',
  QUOTATIONS: 'Quotations',
  INVOICES: 'Invoices',
  PAYMENTS: 'Payments',
  ACTIVITIES: 'Activities',
  CONFIG: 'Config'
};

const STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];

function doGet(e) {
  const view = e && e.parameter ? e.parameter.view : '';

  if (view === 'api') {
    return jsonOutput({
      ok: true,
      service: 'Sale Ecosystem SaaS Web App',
      version: '1.1.0'
    });
  }

  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle('Sale Ecosystem SaaS');
}

function doPost(e) {
  try {
    const path = (e.pathInfo || '').trim();
    const payload = parseBody_(e.postData && e.postData.contents);

    if (!isValidApiKey_(payload.apiKey)) {
      return jsonOutput({ ok: false, error: 'Unauthorized apiKey' });
    }

    switch (path) {
      case 'api/leads':
        return jsonOutput(createLead_(payload));
      case 'api/deals/update':
        return jsonOutput(updateDealStage_(payload));
      case 'api/payments/webhook':
        return jsonOutput(recordPayment_(payload));
      case 'api/dashboard':
        return jsonOutput(getDashboard_());
      default:
        return jsonOutput({ ok: false, error: 'Unknown endpoint', path });
    }
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message || String(error) });
  }
}

function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEETS.LEADS, [
    'leadId', 'createdAt', 'name', 'email', 'phone', 'source', 'value', 'owner', 'status', 'lastFollowupAt'
  ]);

  ensureSheet_(ss, SHEETS.DEALS, [
    'dealId', 'leadId', 'createdAt', 'updatedAt', 'stage', 'value', 'owner', 'nextActionAt', 'note'
  ]);

  ensureSheet_(ss, SHEETS.QUOTATIONS, [
    'quotationId', 'dealId', 'createdAt', 'amount', 'status', 'expireAt'
  ]);

  ensureSheet_(ss, SHEETS.INVOICES, [
    'invoiceId', 'dealId', 'createdAt', 'amount', 'status', 'paidAt'
  ]);

  ensureSheet_(ss, SHEETS.PAYMENTS, [
    'paymentId', 'invoiceId', 'createdAt', 'amount', 'channel', 'txRef'
  ]);

  ensureSheet_(ss, SHEETS.ACTIVITIES, [
    'activityId', 'entityType', 'entityId', 'eventType', 'message', 'createdAt'
  ]);

  const configSheet = ensureSheet_(ss, SHEETS.CONFIG, ['key', 'value']);
  upsertConfig_(configSheet, 'API_KEY', Utilities.getUuid());
  upsertConfig_(configSheet, 'FOLLOWUP_HOURS', '24');

  return { ok: true, message: 'System initialized' };
}

function setupFollowupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'runFollowupAutomation')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runFollowupAutomation')
    .timeBased()
    .everyHours(1)
    .create();

  return { ok: true, message: 'Follow-up trigger created (every hour)' };
}

function runFollowupAutomation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const leadsSheet = ss.getSheetByName(SHEETS.LEADS);
  const followupHours = Number(getConfigValue_('FOLLOWUP_HOURS') || '24');
  const now = new Date();
  const rows = getDataRows_(leadsSheet);

  rows.forEach((row) => {
    const lastFollowupAt = row.lastFollowupAt ? new Date(row.lastFollowupAt) : new Date(row.createdAt);
    const ageHours = (now.getTime() - lastFollowupAt.getTime()) / (1000 * 60 * 60);

    if (row.status !== 'WON' && row.status !== 'LOST' && ageHours >= followupHours) {
      appendActivity_('LEAD', row.leadId, 'FOLLOWUP_REQUIRED', `Lead ${row.name} requires follow-up`);
      updateLeadFollowup_(row.leadId, now);
    }
  });

  return { ok: true, message: 'Follow-up automation completed' };
}

function createLead_(payload) {
  const required = ['name', 'email'];
  validateRequired_(payload, required);

  const leadId = id_('LD');
  const dealId = id_('DL');
  const now = new Date();
  const value = Number(payload.value || 0);

  appendRow_(SHEETS.LEADS, [
    leadId,
    now,
    payload.name,
    payload.email,
    payload.phone || '',
    payload.source || 'Unknown',
    value,
    payload.owner || 'unassigned',
    'NEW',
    now
  ]);

  appendRow_(SHEETS.DEALS, [
    dealId,
    leadId,
    now,
    now,
    'NEW',
    value,
    payload.owner || 'unassigned',
    addHours_(now, 24),
    'Deal auto-created from lead'
  ]);

  appendActivity_('LEAD', leadId, 'CREATED', 'Lead created and deal auto-generated');

  return { ok: true, leadId, dealId };
}

function updateDealStage_(payload) {
  validateRequired_(payload, ['dealId', 'stage']);
  if (!STAGES.includes(payload.stage)) {
    throw new Error('Invalid stage value');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.DEALS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (data[i][0] === payload.dealId) {
      sheet.getRange(i + 1, 4).setValue(new Date());
      sheet.getRange(i + 1, 5).setValue(payload.stage);
      sheet.getRange(i + 1, 9).setValue(payload.note || 'Stage updated via API');

      const dealId = data[i][0];
      const value = Number(data[i][5] || 0);
      appendActivity_('DEAL', dealId, 'STAGE_UPDATED', `Moved to ${payload.stage}`);

      if (payload.stage === 'PROPOSAL') {
        createQuotation_(dealId, value);
      }

      if (payload.stage === 'WON') {
        const invoice = createInvoice_(dealId, value);
        closeLeadByDeal_(dealId, 'WON');
        return { ok: true, dealId, stage: payload.stage, invoiceId: invoice.invoiceId };
      }

      if (payload.stage === 'LOST') {
        closeLeadByDeal_(dealId, 'LOST');
      }

      return { ok: true, dealId, stage: payload.stage };
    }
  }

  throw new Error('Deal not found');
}

function recordPayment_(payload) {
  validateRequired_(payload, ['invoiceId', 'amount']);
  const amount = Number(payload.amount);

  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  appendRow_(SHEETS.PAYMENTS, [
    id_('PAY'),
    payload.invoiceId,
    new Date(),
    amount,
    payload.channel || 'Unknown',
    payload.txRef || ''
  ]);

  updateInvoicePaid_(payload.invoiceId);
  appendActivity_('INVOICE', payload.invoiceId, 'PAID', `Payment recorded amount=${amount}`);

  return { ok: true, invoiceId: payload.invoiceId, amount };
}

function getDashboard_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const deals = getDataRows_(ss.getSheetByName(SHEETS.DEALS));
  const invoices = getDataRows_(ss.getSheetByName(SHEETS.INVOICES));
  const payments = getDataRows_(ss.getSheetByName(SHEETS.PAYMENTS));

  const totalDeals = deals.length;
  const wonDeals = deals.filter((d) => d.stage === 'WON').length;
  const pipelineValue = deals
    .filter((d) => d.stage !== 'WON' && d.stage !== 'LOST')
    .reduce((sum, d) => sum + Number(d.value || 0), 0);
  const invoiceOpen = invoices.filter((inv) => inv.status !== 'PAID').length;
  const revenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    ok: true,
    data: {
      totalDeals,
      wonDeals,
      winRate: totalDeals ? Number(((wonDeals / totalDeals) * 100).toFixed(2)) : 0,
      pipelineValue,
      openInvoices: invoiceOpen,
      revenue
    }
  };
}

function createQuotation_(dealId, amount) {
  const quotationId = id_('QT');
  appendRow_(SHEETS.QUOTATIONS, [quotationId, dealId, new Date(), amount, 'SENT', addHours_(new Date(), 72)]);
  appendActivity_('DEAL', dealId, 'QUOTATION_CREATED', `Quotation ${quotationId} created`);
  return { quotationId };
}

function createInvoice_(dealId, amount) {
  const invoiceId = id_('INV');
  appendRow_(SHEETS.INVOICES, [invoiceId, dealId, new Date(), amount, 'OPEN', '']);
  appendActivity_('DEAL', dealId, 'INVOICE_CREATED', `Invoice ${invoiceId} created`);
  return { invoiceId };
}

function closeLeadByDeal_(dealId, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dealSheet = ss.getSheetByName(SHEETS.DEALS);
  const dealData = dealSheet.getDataRange().getValues();

  let leadId = '';
  for (let i = 1; i < dealData.length; i += 1) {
    if (dealData[i][0] === dealId) {
      leadId = dealData[i][1];
      break;
    }
  }

  if (!leadId) {
    return;
  }

  const leadSheet = ss.getSheetByName(SHEETS.LEADS);
  const leadData = leadSheet.getDataRange().getValues();
  for (let i = 1; i < leadData.length; i += 1) {
    if (leadData[i][0] === leadId) {
      leadSheet.getRange(i + 1, 9).setValue(status);
      leadSheet.getRange(i + 1, 10).setValue(new Date());
      appendActivity_('LEAD', leadId, 'CLOSED', `Lead marked as ${status}`);
      return;
    }
  }
}

function updateInvoicePaid_(invoiceId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.INVOICES);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (data[i][0] === invoiceId) {
      sheet.getRange(i + 1, 5).setValue('PAID');
      sheet.getRange(i + 1, 6).setValue(new Date());
      return;
    }
  }

  throw new Error('Invoice not found');
}

function updateLeadFollowup_(leadId, whenDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.LEADS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (data[i][0] === leadId) {
      sheet.getRange(i + 1, 10).setValue(whenDate);
      return;
    }
  }
}

function appendActivity_(entityType, entityId, eventType, message) {
  appendRow_(SHEETS.ACTIVITIES, [id_('ACT'), entityType, entityId, eventType, message, new Date()]);
}

function parseBody_(rawText) {
  if (!rawText) return {};
  return JSON.parse(rawText);
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const currentHeaders = headerRange.getValues()[0];
  const same = headers.every((h, index) => currentHeaders[index] === h);

  if (!same) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function getDataRows_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (!data.length) return [];
  const headers = data[0];

  return data.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function appendRow_(sheetName, values) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheetByName(sheetName).appendRow(values);
}

function id_(prefix) {
  return `${prefix}-${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}-${Math.floor(Math.random() * 900 + 100)}`;
}

function addHours_(dateObj, hours) {
  return new Date(dateObj.getTime() + hours * 60 * 60 * 1000);
}

function validateRequired_(payload, fields) {
  fields.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  });
}

function upsertConfig_(configSheet, key, value) {
  const data = configSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i += 1) {
    if (data[i][0] === key) {
      configSheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  configSheet.appendRow([key, value]);
}

function getConfigValue_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i += 1) {
    if (data[i][0] === key) {
      return data[i][1];
    }
  }

  return '';
}

function isValidApiKey_(apiKey) {
  return apiKey && apiKey === getConfigValue_('API_KEY');
}
