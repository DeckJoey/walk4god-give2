// netlify/functions/stripe-webhook.js
//
// Stripe calls this automatically after a checkout completes.
// It sends TWO emails via Resend: a Receipt and a separate Thank You.
//
// Required env vars (set in Netlify):
//   STRIPE_SECRET_KEY        (already set)
//   STRIPE_WEBHOOK_SECRET    (from Stripe Dashboard -> Developers -> Webhooks -> your endpoint)
//   RESEND_API_KEY           (from resend.com)
//   FROM_EMAIL                e.g. "The Walk <giving@thewalk4god.com>" (must be a verified domain in Resend)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FUND_LABELS = {
  general: 'General Fund',
  gear: 'Gear for the Road',
  events: 'Walk Events',
};

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
  }
}

function receiptEmailHtml({ name, amount, fundLabel, date, transactionId }) {
  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#06070a;color:#F1F3F6;padding:32px;">
    <h2 style="margin:0 0 20px;">The Walk</h2>
    <p>Hi ${name || 'friend'},</p>
    <p>On <strong>${date}</strong> your gift to <strong>The Walk</strong> was made successfully.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr><td style="padding:8px 0;color:#9AA0AB;">Gift amount</td><td style="padding:8px 0;text-align:right;">$${amount}</td></tr>
      <tr><td style="padding:8px 0;color:#9AA0AB;">Giving type</td><td style="padding:8px 0;text-align:right;">${fundLabel}</td></tr>
      <tr><td style="padding:8px 0;color:#9AA0AB;">Transaction No.</td><td style="padding:8px 0;text-align:right;">${transactionId}</td></tr>
    </table>
    <p style="font-size:12px;color:#9AA0AB;">No goods or services were provided in exchange for this contribution other than intangible religious benefits. Please keep this email for your tax records.</p>
    <p style="font-size:12px;color:#9AA0AB;">The Walk</p>
  </div>`;
}

function thankYouEmailHtml({ name }) {
  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#06070a;color:#F1F3F6;padding:32px;">
    <h2 style="margin:0 0 20px;">Thank you for giving 🙏</h2>
    <p>Hey ${name || 'friend'},</p>
    <p>Thank you for planting a seed of faith! We're so grateful for your generosity — it helps us keep sharing the hope of Jesus and walking alongside people who need a community to walk with.</p>
    <p>We know no single gift changes everything on its own, but together, step by step, we believe God brings the increase.</p>
    <p>As you keep walking with us, we'd love for you to invite the people in your life to walk along too. Together we're stronger.</p>
    <p>We're praying you experience the peace and presence of God in a real way this season. The best is still ahead.</p>
    <p>All for Jesus,<br><strong>The Walk Team</strong></p>
  </div>`;
}

exports.handler = async function (event) {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      // Expand to get customer email + line item details
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items', 'customer'],
      });

      const email = fullSession.customer_details?.email || fullSession.customer_email;
      const name = fullSession.customer_details?.name || '';
      const amount = ((fullSession.amount_total || 0) / 100).toFixed(2);
      const fund = fullSession.metadata?.fund;
      const fundLabel = FUND_LABELS[fund] || 'General Fund';
      const date = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });

      if (email) {
        // Two separate emails, sent back to back
        await sendEmail({
          to: email,
          subject: 'Your Giving Receipt — The Walk',
          html: receiptEmailHtml({ name, amount, fundLabel, date, transactionId: session.id }),
        });

        await sendEmail({
          to: email,
          subject: 'Thank You for Giving!',
          html: thankYouEmailHtml({ name }),
        });
      } else {
        console.warn('No email found on session, skipping emails.');
      }
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
