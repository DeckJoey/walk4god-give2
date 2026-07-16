// netlify/functions/create-checkout-session.js
//
// This runs on Netlify's servers, never in the browser.
// Your Stripe SECRET key lives only in Netlify's environment variables
// (set in Site settings -> Environment variables -> STRIPE_SECRET_KEY),
// never in this file and never in the frontend.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Map your "Giving Type" dropdown values to human-readable labels
const FUND_LABELS = {
  general: 'General Fund',
  gear: 'Gear for the Road',
  events: 'Walk Events',
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { giftType, frequency, fund, amount } = body;

    // ---- Server-side validation (never trust the client) ----
    const desiredCents = parseInt(amount, 10);
    if (!Number.isFinite(desiredCents) || desiredCents < 100) {
      // 100 cents = $1 minimum
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Minimum gift amount is $1.' }),
      };
    }

    // Gross up so the ministry nets the full amount the donor intended,
    // after Stripe's US card fee of 2.9% + $0.30.
    // total = (desired + 30) / (1 - 0.029), everything in cents.
    const amountCents = Math.round((desiredCents + 30) / (1 - 0.029));

    const fundLabel = FUND_LABELS[fund] || 'General Fund';

    const siteUrl = process.env.SITE_URL || 'https://YOUR-SITE-URL-HERE';

    let session;

    if (giftType === 'recurring') {
      if (frequency !== 'week' && frequency !== 'month') {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Unsupported frequency.' }),
        };
      }

      // Stripe requires a Price object for subscriptions.
      // We create one on the fly with the custom amount, tied to
      // a recurring interval matching the chosen frequency.
      const price = await stripe.prices.create({
        currency: 'usd',
        unit_amount: amountCents,
        recurring: { interval: frequency }, // 'week' or 'month'
        product_data: {
          name: `Recurring Gift — ${fundLabel} (includes processing fee)`,
        },
      });

      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: undefined,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${siteUrl}/give-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/give.html`,
        metadata: { fund, giftType, frequency, desiredCents: String(desiredCents) },
        subscription_data: {
          metadata: { fund, giftType, frequency, desiredCents: String(desiredCents) },
        },
      });
    } else {
      // One-time gift
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_creation: 'always',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amountCents,
              product_data: {
                name: `One-Time Gift — ${fundLabel} (includes processing fee)`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${siteUrl}/give-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/give.html`,
        metadata: { fund, giftType, desiredCents: String(desiredCents) },
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unable to start checkout. Please try again.' }),
    };
  }
};
