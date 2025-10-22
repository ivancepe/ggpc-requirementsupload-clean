const axios = require('axios');

exports.handler = async (event) => {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com';
  const KINTONE_APP_ID = '1586';
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh';

  const url = `https://${KINTONE_DOMAIN}/k/v1/records.json`;
  const headers = { 'X-Cybozu-API-Token': KINTONE_API_TOKEN };

  const email = event.queryStringParameters?.email;
  if (!email) {
    return { statusCode: 400, body: 'Missing email' };
  }

  const resp = await axios.get(url, {
    params: {
      app: KINTONE_APP_ID,
      query: `Email = "${email.trim()}"`,
      fields: 'Full_Name,Email',
    },
    headers,
  });

  if (resp.data.records.length > 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ name: resp.data.records[0].Full_Name.value }),
    };
  } else {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'No matching name found' }),
    };
  }
};