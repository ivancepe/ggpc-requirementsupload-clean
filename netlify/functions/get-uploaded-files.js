const { google } = require('googleapis');

exports.handler = async (event) => {
  const name = event.queryStringParameters?.name;
  if (!name) {
    return { statusCode: 400, body: 'Missing name' };
  }

  // Setup Google Drive API (use your credentials/env)
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Use your actual parent folder and shared drive IDs
  const { data } = await drive.files.list({
    q: `'1TdHKXJzci-WND9FpHWVf9HFjBJk3Obc9' in parents and name = "${name}" and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    driveId: '0AKdbJt90_Md2Uk9PVA',
    corpora: 'drive',
  });

  if (!data.files.length) {
    return { statusCode: 200, body: JSON.stringify([]) };
  }

  // List files in the applicant's folder
  const folderId = data.files[0].id;
  const files = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    driveId: '0AKdbJt90_Md2Uk9PVA',
    corpora: 'drive',
  });

  const uploaded = files.data.files.map(f => f.name);
  return {
    statusCode: 200,
    body: JSON.stringify(uploaded),
  };
};