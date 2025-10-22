const { google } = require('googleapis');

// --- Constants for IDs ---
// Best practice to keep IDs in one place for easy updates.
const SHARED_DRIVE_ID = '0AKdbJt90_Md2Uk9PVA';
const APPLICANT_PARENT_FOLDER_ID = '1TdHKXJzci-WND9FpHWVf9HFjBJk3Obc9';

// --- Google API Setup ---
// Initialize outside the handler for better performance (re-used across invocations).
const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });


exports.handler = async (event) => {
  const name = event.queryStringParameters?.name;

  if (!name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing name parameter.' }),
    };
  }

  // Sanitize name to match the format used for folder creation
  const safeName = name.replace(/[^a-zA-Z0-9,\- ]/g, '').trim();

  try {
    // --- Step 1: Find the applicant's folder ---
    const folderSearch = await drive.files.list({
      q: `'${APPLICANT_PARENT_FOLDER_ID}' in parents and name = "${safeName}" and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)', // We only need the ID
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      driveId: SHARED_DRIVE_ID,
      corpora: 'drive',
    });

    // If no folder is found, the user has no uploaded files yet.
    if (!folderSearch.data.files || folderSearch.data.files.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify([]), // Return an empty array
      };
    }
    const folderId = folderSearch.data.files[0].id;

    // --- Step 2: List all files within that folder ---
    const fileList = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(name)', // We only need the file names
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      driveId: SHARED_DRIVE_ID,
      corpora: 'drive',
      pageSize: 200, // Handle up to 200 requirements files
    });

    // Extract just the names into a simple array
    const uploadedFileNames = fileList.data.files ? fileList.data.files.map(f => f.name) : [];

    // --- Step 3: Return the list of file names ---
    return {
      statusCode: 200,
      body: JSON.stringify(uploadedFileNames),
    };

  } catch (error) {
    // If any Google Drive API call fails, catch the error
    console.error('Google Drive API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred while fetching files from Google Drive.' }),
    };
  }
};