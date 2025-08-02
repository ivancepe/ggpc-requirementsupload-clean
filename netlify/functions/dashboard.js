const { google } = require('googleapis');

const REQUIRED_FILES = [
  'Resume',
  'Birth Certificate',
  'Marriage Contract',
  'Children-BC',
  'TOR-Diploma',
  'BIR2316',
  'COE',
  'Barangay',
  'Police',
  'NBI',
  'SSS', // <-- COMBINED FIELD
  'Philhealth',
  'Pag-ibig',
  'TIN',
  'Medical'
];

const normalize = str =>
  str.toLowerCase().replace(/[^a-z0-9]/g, ''); // remove non-alphanumeric

exports.handler = async () => {
  try {
    // ✅ Read credentials from env var
    const credentialsJSON = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8');
    const CREDENTIALS = JSON.parse(credentialsJSON);

    const auth = new google.auth.GoogleAuth({
      credentials: CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // 1. List applicant folders (replace with your parent folder ID)
    const { data } = await drive.files.list({
      q: "'1TdHKXJzci-WND9FpHWVf9HFjBJk3Obc9' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      driveId: '0AKdbJt90_Md2Uk9PVA', // your Shared Drive ID
      corpora: 'drive',
    });

    const applicants = [];
    for (const folder of data.files) {
      // 2. List files in each folder
      const files = await drive.files.list({
        q: `'${folder.id}' in parents`,
        fields: 'files(name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        driveId: '0AKdbJt90_Md2Uk9PVA',
        corpora: 'drive',
      });

      // Use the actual file names (lowercased, trimmed)
      const uploadedFiles = files.data.files.map(f =>
        normalize(f.name.replace(/^[^-\n]+ - /, '').replace(/\.[^/.]+$/, ''))
      );

      // For each required file, check if any uploaded file includes the required file name (normalized)
      const uploaded = REQUIRED_FILES.map(req => {
        const reqNorm = normalize(req.replace(/\.[^/.]+$/, ''));
        return uploadedFiles.some(fileName => fileName === reqNorm) ? req : null;
      }).filter(Boolean);

      const childrenNone =
        uploadedFiles.some(fileName => normalize(fileName) === 'children-bc') &&
        !uploadedFiles.some(fileName => normalize(fileName) === 'children-bc-yes');

      const notMarried =
        uploadedFiles.some(fileName => normalize(fileName) === 'marriage-contract') &&
        !uploadedFiles.some(fileName => normalize(fileName) === 'marriage-contract-yes');

      applicants.push({
        name: folder.name,
        email: '', // or fetch from your data source if available
        uploaded,
        specialNotes: [
          childrenNone ? 'Applicant checked "None" for Children Birth Certificates.' : '',
          notMarried ? 'Applicant checked "Not Married" for Marriage Contract.' : ''
        ].filter(Boolean).join('<br>')
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        requiredFiles: REQUIRED_FILES,
        applicants,
      }),
    };
  } catch (err) {
    console.error('DASHBOARD ERROR:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
