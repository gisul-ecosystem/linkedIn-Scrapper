const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function writeConnectionsExcel(profiles, filePath, meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'linkedin-scrapper';

  const sheet = workbook.addWorksheet('Connections');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Headline', key: 'headline', width: 40 },
    { header: 'Company', key: 'company', width: 28 },
    { header: 'Location', key: 'location', width: 24 },
    { header: 'Relevant', key: 'relevant', width: 10 },
    { header: 'Score', key: 'relevanceScore', width: 10 },
    { header: 'Recommended Product', key: 'productName', width: 16 },
    { header: 'Product URL', key: 'productUrl', width: 28 },
    { header: 'AI Reason', key: 'aiReason', width: 40 },
    { header: 'AI Message', key: 'aiMessage', width: 55 },
    { header: 'Profile URL', key: 'profileUrl', width: 50 },
    { header: 'About', key: 'about', width: 40 },
    { header: 'Message Sent', key: 'messageSent', width: 14 },
    { header: 'Message Sent At', key: 'messageSentAt', width: 22 },
    { header: 'Scraped At', key: 'scrapedAt', width: 22 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0A66C2' },
  };

  for (const p of profiles) {
    sheet.addRow({
      name: p.name,
      headline: p.headline,
      company: p.company,
      location: p.location,
      relevant: p.relevant === false ? 'No' : p.relevant ? 'Yes' : '',
      relevanceScore: p.relevanceScore ?? '',
      productName: p.productName || p.recommendedProduct || '',
      productUrl: p.productUrl || '',
      aiReason: p.aiReason || '',
      aiMessage: p.aiMessage || p.lastMessage || '',
      profileUrl: p.profileUrl,
      about: p.about,
      messageSent: p.messageSent ? 'Yes' : 'No',
      messageSentAt: p.messageSentAt || '',
      scrapedAt: p.scrapedAt || '',
    });
  }

  const metaSheet = workbook.addWorksheet('Scrape Info');
  metaSheet.columns = [
    { header: 'Key', key: 'k', width: 24 },
    { header: 'Value', key: 'v', width: 80 },
  ];
  for (const [k, v] of Object.entries(meta)) {
    metaSheet.addRow({ k, v: String(v) });
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp.xlsx`;
  await workbook.xlsx.writeFile(tmp);
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    const fallback = filePath.replace(/\.xlsx$/i, `-${Date.now()}.xlsx`);
    fs.renameSync(tmp, fallback);
    return fallback;
  }
  return filePath;
}

async function writeDailySendReportExcel(sentProfiles, filePath, meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'linkedin-scrapper';

  const sheet = workbook.addWorksheet('Daily Sends');
  sheet.columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Sent At', key: 'messageSentAt', width: 22 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Headline', key: 'headline', width: 36 },
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Product', key: 'productName', width: 28 },
    { header: 'Score', key: 'relevanceScore', width: 10 },
    { header: 'Message Sent', key: 'aiMessage', width: 70 },
    { header: 'Fit Reason', key: 'aiReason', width: 40 },
    { header: 'Profile URL', key: 'profileUrl', width: 50 },
    { header: 'Status', key: 'queueStatus', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0B5CAB' },
  };

  sentProfiles.forEach((p, i) => {
    sheet.addRow({
      n: i + 1,
      messageSentAt: p.messageSentAt || '',
      name: p.name || '',
      headline: p.headline || '',
      company: p.company || '',
      location: p.location || '',
      productName: p.productName || p.recommendedProduct || '',
      relevanceScore: p.relevanceScore ?? '',
      aiMessage: p.aiMessage || p.lastMessage || '',
      aiReason: p.aiReason || '',
      profileUrl: p.profileUrl || '',
      queueStatus: p.queueStatus || (p.messageSent ? 'sent' : ''),
    });
  });

  const metaSheet = workbook.addWorksheet('Report Info');
  metaSheet.columns = [
    { header: 'Key', key: 'k', width: 24 },
    { header: 'Value', key: 'v', width: 80 },
  ];
  for (const [k, v] of Object.entries({
    ...meta,
    totalSent: sentProfiles.length,
    generatedAt: new Date().toISOString(),
  })) {
    metaSheet.addRow({ k, v: String(v) });
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp.xlsx`;
  await workbook.xlsx.writeFile(tmp);
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    const fallback = filePath.replace(/\.xlsx$/i, `-${Date.now()}.xlsx`);
    fs.renameSync(tmp, fallback);
    return fallback;
  }
  return filePath;
}

module.exports = { writeConnectionsExcel, writeDailySendReportExcel };
