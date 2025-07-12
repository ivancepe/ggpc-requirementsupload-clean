const axios = require('axios');

exports.handler = async () => {
  const KINTONE_DOMAIN = 'vez7o26y38rb.cybozu.com';
  const KINTONE_APP_ID = '1586';
  const KINTONE_API_TOKEN = '7DEiGz9DyRxKHoT1xwwvWBBq5k999YGVr1gRhKkh';

  const url = `https://${KINTONE_DOMAIN}/k/v1/records.json`;
  const headers = { 'X-Cybozu-API-Token': KINTONE_API_TOKEN };

  const resp = await axios.get(url, {
    params: {
      app: KINTONE_APP_ID,
      fields: 'Full_Name',
      query: '',
    },
    headers,
  });

  const names = resp.data.records.map(r => r.Full_Name.value);
  return {
    statusCode: 200,
    body: JSON.stringify(names),
  };
};