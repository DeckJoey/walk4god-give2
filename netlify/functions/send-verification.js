// netlify/functions/send-verification.js
//
// Sends a one-time SMS code to a phone number using Twilio's Verify API.
// Twilio credentials live only in Netlify's environment variables:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_VERIFY_SERVICE_SID

const twilio = require('twilio');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone } = JSON.parse(event.body || '{}');

    // Basic sanity check: expect E.164 format like +11234567890
    if (!phone || !/^\+1\d{10}$/.test(phone)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Enter a valid 10-digit US mobile number.' }),
      };
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: 'sms' });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Could not send the code. Please try again.' }),
    };
  }
};
