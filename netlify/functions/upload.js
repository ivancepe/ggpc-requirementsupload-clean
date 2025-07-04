const { google } = require('googleapis');
const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');

const CREDENTIALS = require('./credentials.json');
//sgMail.setApiKey(process.env.SENDGRID_API_KEY); // Set your SendGrid API key in Netlify env vars

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
      // Ignore empty file fields
      if (!filename) {
        file.resume(); // drain the stream
        return;
      }
      // Use a unique temp filename to avoid collisions and Windows issues
      const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const filepath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).substring(2)}-${safeFilename}`);
      const writeStream = fs.createWriteStream(filepath);
      let fileSize = 0;
      file.on('data', (data) => {
        fileSize += data.length;
      });
      file.pipe(writeStream);
      uploads.push(
        new Promise((res, rej) => {
          writeStream.on('finish', () => {
            // Only resolve if file has content
            if (fileSize > 0) {
              res({ filepath, filename: safeFilename, mimetype });
            } else {
              fs.unlink(filepath, () => {}); // remove empty file
              res(null);
            }
          });
          writeStream.on('error', rej);
        })
      );
    });

    busboy.on('finish', async () => {
      try {
        const uploadedFiles = await Promise.all(uploads);

        // Google Auth
        const auth = new google.auth.GoogleAuth({
          credentials: CREDENTIALS,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        const drive = google.drive({ version: 'v3', auth });

        // Get full name from fields
        const fullName = fields.fullname || 'Unknown';

        // Sanitize full name for filename
        const safeFullName = fullName.replace(/[^a-zA-Z0-9,\- ]/g, '').trim();

        // Get or create subfolder
        const parentFolderId = '10UqtgofK9WB28q3fm7izghzHBCoj4Rdr'; // Your main folder ID
        const subfolderId = await getOrCreateSubfolder(drive, parentFolderId, fullName);

        // Upload each file to the subfolder
        for (const file of uploadedFiles) {
          // Format: "Lastname, Firstname - OriginalFilename.pdf"
          const renamedFilename = `${safeFullName} - ${file.filename}`;
          await drive.files.create({
            requestBody: {
              name: renamedFilename,
              parents: [subfolderId],
            },
            media: {
              mimeType: file.mimetype,
              body: fs.createReadStream(file.filepath),
            },
          });
          fs.unlinkSync(file.filepath); // Clean up temp file
        }

        // List of required files (update as needed)
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
          'SSS',
          'E1E4',
          'Philhealth',
          'Pag-ibig',
          'TIN'
        ];

        // Get the uploaded file names (without applicant name prefix)
        const uploadedNames = uploadedFiles
          .filter(Boolean)
          .map(f => {
            // Remove "Lastname, Firstname - " prefix and extension
            let name = f.filename.replace(/^[^-\n]+ - /, '').replace(/\.[^/.]+$/, '').toLowerCase().trim();
            return name;
          });

        // Build the lists
        const uploadedList = [];
        const toFollowList = [];

        REQUIRED_FILES.forEach(req => {
          // Normalize required file name for comparison
          const reqNorm = req.toLowerCase().replace(/[^a-z0-9]/g, '');
          const found = uploadedNames.some(name => {
            const nameNorm = name.replace(/[^a-z0-9]/g, '');
            // Two-way fuzzy match
            return nameNorm.includes(reqNorm) || reqNorm.includes(nameNorm);
          });
          if (found) {
            uploadedList.push(req);
          } else {
            toFollowList.push(req);
          }
        });

        // Check for special notes
        const childrenNone = fields.children_none === 'none';
        const notMarried = fields.marital_status === 'not_married';

        let specialNotes = '';
        if (childrenNone) {
          specialNotes += '<li>Applicant checked "None" for Children Birth Certificates.</li>';
        }
        if (notMarried) {
          specialNotes += '<li>Applicant checked "Not Married" for Marriage Contract.</li>';
        }

        // Now build your email bodies using specialNotes
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

        // Build HR email body FIRST
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

        // Send confirmation to applicant
        await transporter.sendMail({
          from: `"GGPC Recruitment Team" <${process.env.EMAIL_USER}>`,
          to: fields.email,
          subject: 'GGPC Requirements Submission Confirmation',
          html: emailBody,
        });

        // Send notification to HR
        await transporter.sendMail({
          from: `"GGPC Recruitment System" <${process.env.EMAIL_USER}>`,
          to: 'ivangolosinda2@gmail.com',
          subject: `New Requirements Submission: ${fields.fullname}`,
          html: hrEmailBody,
        });

        // Send folder link to Kintone
        const applicantName = fields.fullname; // Get applicant name from fields
        const recordId = await getKintoneRecordIdByName(applicantName); // applicantName from form
        if (recordId) {
          await sendFolderLinkToKintone({ recordId, folderId: subfolderId });
        }

        resolve({
          statusCode: 200,
          body: JSON.stringify({ uploaded: true }),
        });
      } catch (err) {
        console.error('UPLOAD ERROR:', err); // Add this line
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    // Pipe the request body to busboy
    const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    busboy.end(buffer);
  });
};

const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');

async function getKintoneRecordIdByName(applicantName) {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com';
  const KINTONE_APP_ID = '1586';
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh';

  const url = `https://${KINTONE_DOMAIN}/k/v1/records.json`;
  const headers = {
    'X-Cybozu-API-Token': KINTONE_API_TOKEN,
  };

  const resp = await axios.get(url, {
    params: {
      app: KINTONE_APP_ID,
      query: `Full_Name = "${applicantName.trim()}"`, // Change 'Full_Name' to your field code
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
  // Check if folder already exists
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  // Create folder if not exists
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });
  return folder.data.id;  
}

async function sendFolderLinkToKintone({ recordId, folderId }) {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com'; // change this
  const KINTONE_APP_ID = '1586'; // change this 
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh'; // change this
  const KINTONE_FIELD_CODE = 'Gdrive_Requirements'; // change this

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

// fetch('/.netlify/functions/upload', { method: 'POST', body: formData });