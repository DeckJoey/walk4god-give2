// netlify/functions/check-verification.js
//
// Confirms the code the person typed in matches what Twilio texted them.

const twilio = require('twilio');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone, code } = JSON.parse(event.body || '{}');

    if (!phone || !code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Missing phone number or code.' }),
      };
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: code });

    if (check.status === 'approved') {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: "That code didn't match. Try again." }),
    };
  } catch (err) {
    console.error(err);
    // Twilio throws if the code is expired/invalid/max attempts reached
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: 'That code is invalid or expired. Try resending.' }),
    };
  }
};
