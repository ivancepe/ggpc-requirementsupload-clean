const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('./service-account.json', 'utf8'));
const SHARED_DRIVE_ID = '0AKdbJt90_Md2Uk9PVA'; // Replace with your actual ID

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Create a test file
  fs.writeFileSync('test.txt', 'Hello from service account!');

  // Replace 'YOUR_FOLDER_ID' with the actual folder ID from the Shared Drive
  const res = await drive.files.create({
    requestBody: {
      name: 'test.txt',
      parents: ['19uxgOcFhT9Q21bGsTJ2ISuX-docBrzXu'],
    },
    media: {
      mimeType: 'text/plain',
      body: fs.createReadStream('test.txt'),
    },
    fields: 'id',
    supportsAllDrives: true,
  }, {
    driveId: SHARED_DRIVE_ID,
    supportsAllDrives: true,
  });

  console.log('Uploaded file ID:', res.data.id);
}

main().catch(console.error);