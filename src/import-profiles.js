const ExcelJS = require('exceljs');
const { normalizeProfileUrl, slugFromProfileUrl, nameFromSlug } = require('./utils');

const URL_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s,"'<>\\]+/gi;

function cleanUrlCandidate(raw) {
  return normalizeProfileUrl(String(raw || '').replace(/[).,;]+$/g, '').trim());
}

function pushRow(out, seen, { profileUrl, listName, subtitle, headline }) {
  const url = cleanUrlCandidate(profileUrl);
  const slug = slugFromProfileUrl(url);
  if (!url || !slug || seen.has(slug)) return;
  seen.add(slug);
  out.push({
    profileUrl: url,
    listName: String(listName || '').trim() || nameFromSlug(slug),
    subtitle: String(subtitle || '').trim(),
    headline: String(headline || '').trim(),
  });
}

function harvestUrlsFromText(text, seen, out) {
  const matches = String(text || '').match(URL_RE) || [];
  for (const m of matches) {
    pushRow(out, seen, { profileUrl: m });
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') {
      cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell || '').trim()));
}

function headerIndex(headers, names) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

function rowsToConnections(rows) {
  const out = [];
  const seen = new Set();
  if (!rows.length) return out;

  const headers = rows[0].map((h) => String(h || '').trim());
  const urlIdx = headerIndex(headers, ['url', 'profile url', 'profileurl', 'linkedin url', 'linkedin']);
  const firstIdx = headerIndex(headers, ['first name', 'firstname', 'first']);
  const lastIdx = headerIndex(headers, ['last name', 'lastname', 'last']);
  const nameIdx = headerIndex(headers, ['name', 'full name', 'fullname']);
  const companyIdx = headerIndex(headers, ['company', 'organization', 'organisation']);
  const positionIdx = headerIndex(headers, ['position', 'title', 'job title', 'headline']);

  const hasHeader = urlIdx >= 0 || firstIdx >= 0 || nameIdx >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  for (const row of dataRows) {
    const cells = row.map((c) => String(c || '').trim());
    const fromCol = urlIdx >= 0 ? cells[urlIdx] : '';
    const first = firstIdx >= 0 ? cells[firstIdx] : '';
    const last = lastIdx >= 0 ? cells[lastIdx] : '';
    const full = nameIdx >= 0 ? cells[nameIdx] : `${first} ${last}`.trim();
    const company = companyIdx >= 0 ? cells[companyIdx] : '';
    const position = positionIdx >= 0 ? cells[positionIdx] : '';

    if (fromCol && /linkedin\.com\/in\//i.test(fromCol)) {
      pushRow(out, seen, {
        profileUrl: fromCol,
        listName: full,
        subtitle: company,
        headline: position,
      });
      continue;
    }
    harvestUrlsFromText(cells.join(' '), seen, out);
  }

  return out;
}

function parseCsvBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  return rowsToConnections(parseCsvRows(text));
}

function cellToString(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (value.hyperlink) return String(value.hyperlink);
    if (value.text) return String(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text || '').join('');
    if (value.result != null) return String(value.result);
  }
  return String(value);
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellToString(cell.value));
      });
      if (cells.some((c) => c.trim())) rows.push(cells);
    });
  });
  return rowsToConnections(rows);
}

async function parseConnectionFile(buffer, filename = '') {
  const name = String(filename || '').toLowerCase();
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (!buf.length) return [];

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsxBuffer(buf);
  }
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsvBuffer(buf);
  }

  // Unknown extension: try CSV first, then xlsx
  const csvRows = parseCsvBuffer(buf);
  if (csvRows.length) return csvRows;
  try {
    return await parseXlsxBuffer(buf);
  } catch {
    return csvRows;
  }
}

module.exports = { parseConnectionFile, parseCsvBuffer };
