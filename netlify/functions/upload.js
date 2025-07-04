const SHARED_DRIVE_ID = '0AKdbJt90_Md2Uk9PVA';
const APPLICANT_PARENT_FOLDER_ID = '1TdHKXJzci-WND9FpHWVf9HFjBJk3Obc9';

const { google } = require('googleapis');
const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');

const credentialsJSON = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8');
const credentials = JSON.parse(credentialsJSON);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return new Promise((resolve, reject) => {
    const busboy = new Busboy({
      headers: {
        ...event.headers,
        'content-type': event.headers['content-type'] || event.headers['Content-Type'],
      },
    });

    const fields = {};
    const uploads = [];

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      if (!filename) {
        file.resume();
        return;
      }
      const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const filepath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).substring(2)}-${safeFilename}`);
      const writeStream = fs.createWriteStream(filepath);
      let fileSize = 0;

      file.on('data', (data) => { fileSize += data.length; });
      file.pipe(writeStream);

      uploads.push(
        new Promise((res, rej) => {
          writeStream.on('finish', () => {
            if (fileSize > 0) {
              res({ filepath, filename: safeFilename, mimetype });
            } else {
              fs.unlink(filepath, () => {});
              res(null);
            }
          });
          writeStream.on('error', rej);
        })
      );
    });

    busboy.on('finish', async () => {
      let uploadedFiles = [];
      try {
        uploadedFiles = (await Promise.all(uploads)).filter(Boolean);

        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/drive'],
        });
        const drive = google.drive({ version: 'v3', auth });

        const fullName = fields.fullname || 'Unknown';
        const safeFullName = fullName.replace(/[^a-zA-Z0-9,\- ]/g, '').trim();

        const parentFolderId = APPLICANT_PARENT_FOLDER_ID;
        const subfolderId = await getOrCreateSubfolder(drive, parentFolderId, fullName);

        // Upload all files in parallel
        const uploadResults = await Promise.all(uploadedFiles.map(async (file) => {
          const renamedFilename = `${safeFullName} - ${file.filename}`;
          try {
            const uploadResponse = await drive.files.create({
              requestBody: {
                name: renamedFilename,
                parents: [subfolderId],
              },
              media: {
                mimeType: file.mimetype,
                body: fs.createReadStream(file.filepath),
              },
              fields: 'id',
              supportsAllDrives: true,
            }, {
              driveId: SHARED_DRIVE_ID,
              supportsAllDrives: true,
            });

            // Optionally set permissions here if needed
            // await drive.permissions.create({ ... });

            return { ...file, id: uploadResponse.data.id };
          } catch (err) {
            console.error('Upload failed:', err);
            return null;
          } finally {
            fs.unlink(file.filepath, () => {});
          }
        }));

        const REQUIRED_FILES = [
          'Resume', 'Birth Certificate', 'Marriage Contract', 'Children-BC', 'TOR-Diploma',
          'BIR2316', 'COE', 'Barangay', 'Police', 'NBI', 'SSS', 'E1E4', 'Philhealth', 'Pag-ibig', 'TIN'
        ];

        const uploadedNames = uploadedFiles
          .filter(Boolean)
          .map(f => f.filename.replace(/^[^-\n]+ - /, '').replace(/\.[^/.]+$/, '').toLowerCase().trim());

        const uploadedList = [];
        const toFollowList = [];

        REQUIRED_FILES.forEach(req => {
          const reqNorm = req.toLowerCase().replace(/[^a-z0-9]/g, '');
          const found = uploadedNames.some(name => {
            const nameNorm = name.replace(/[^a-z0-9]/g, '');
            return nameNorm.includes(reqNorm) || reqNorm.includes(nameNorm);
          });
          if (found) {
            uploadedList.push(req);
          } else {
            toFollowList.push(req);
          }
        });

        const childrenNone = fields.children_none === 'none';
        const notMarried = fields.marital_status === 'not_married';

        let specialNotes = '';
        if (childrenNone) {
          specialNotes += '<li>Applicant checked "None" for Children Birth Certificates.</li>';
        }
        if (notMarried) {
          specialNotes += '<li>Applicant checked "Not Married" for Marriage Contract.</li>';
        }

        const emailBody = `
Hello ${fields.fullname},<br><br>
Thank you for submitting your requirements. Here is the summary:<br><br>
<strong>Uploaded Files:</strong>
<ul>
${uploadedList.map(f => `<li>${f}</li>`).join('')}
</ul>
<strong>To Follow:</strong>
<ul>
${toFollowList.map(f => `<li>${f}</li>`).join('')}
</ul>
If you have questions, please contact us.<br><br>
Regards,<br>
GGPC Recruitment Team
`;

        const hrEmailBody = `
<p><strong>Name:</strong> ${fields.fullname}</p>
<p><strong>Email:</strong> ${fields.email}</p>

<p><strong>New Requirements Submission</strong></p>

<strong>Uploaded Files:</strong>
<ul>
${uploadedList.map(f => `<li>${f}</li>`).join('')}
</ul>
<strong>To Follow:</strong>
<ul>
${toFollowList.map(f => `<li>${f}</li>`).join('')}
</ul>

${specialNotes ? `<strong>Special Notes:</strong><ul>${specialNotes}</ul>` : ''}
<p>Submission Date: ${new Date().toLocaleString()}</p>
`;

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        await transporter.sendMail({
          from: `"GGPC Recruitment Team" <${process.env.EMAIL_USER}>`,
          to: fields.email,
          subject: 'GGPC Requirements Submission Confirmation',
          html: emailBody,
        });

        await transporter.sendMail({
          from: `"GGPC Recruitment System" <${process.env.EMAIL_USER}>`,
          to: 'ivangolosinda2@gmail.com', //recruitment.ggpc@gmail.com
          subject: `New Requirements Submission: ${fields.fullname}`,
          html: hrEmailBody,
        });

        const applicantName = fields.fullname;
        const recordId = await getKintoneRecordIdByName(applicantName);
        if (recordId) {
          await sendFolderLinkToKintone({ recordId, folderId: subfolderId });
        }

        resolve({
          statusCode: 200,
          body: JSON.stringify({ uploaded: true }),
        });
      } catch (err) {
        console.error('UPLOAD ERROR:', err);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    busboy.end(buffer);
  });
};

async function getKintoneRecordIdByName(applicantName) {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com';
  const KINTONE_APP_ID = '1586';
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh';

  const url = `https://${KINTONE_DOMAIN}/k/v1/records.json`;
  const headers = { 'X-Cybozu-API-Token': KINTONE_API_TOKEN };

  const resp = await axios.get(url, {
    params: {
      app: KINTONE_APP_ID,
      query: `Full_Name = "${applicantName.trim()}"`,
      fields: '$id,Full_Name',
    },
    headers,
  });

  if (resp.data.records.length > 0 && resp.data.records[0].$id) {
    return resp.data.records[0].$id.value;
  }
  return null;
}

async function getOrCreateSubfolder(drive, parentFolderId, folderName) {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    driveId: SHARED_DRIVE_ID,
    corpora: 'drive', 
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId], // This is the ID from the Shared Drive
    },
    fields: 'id',
    supportsAllDrives: true,
  }, {
    driveId: SHARED_DRIVE_ID,
    supportsAllDrives: true,
  });
  return folder.data.id;  
}

async function sendFolderLinkToKintone({ recordId, folderId }) {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com';
  const KINTONE_APP_ID = '1586';
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh';
  const KINTONE_FIELD_CODE = 'Gdrive_Requirements';

  const folderLink = `https://drive.google.com/drive/folders/${folderId}`;

  const url = `https://${KINTONE_DOMAIN}/k/v1/record.json`;
  const headers = {
    'X-Cybozu-API-Token': KINTONE_API_TOKEN,
    'Content-Type': 'application/json',
  };

  await axios.put(url, {
    app: KINTONE_APP_ID,
    id: recordId,
    record: {
      [KINTONE_FIELD_CODE]: { value: folderLink },
    },
  }, { headers });
}
