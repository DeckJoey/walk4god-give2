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
const { getStore } = require('@netlify/blobs');

async function appendToDay(prefix, record) {
  const store = getStore('adminEvents');
  const day = new Date().toISOString().slice(0, 10);
  const key = `${prefix}:${day}`;
  const existing = (await store.get(key, { type: 'json' })) || [];
  existing.push(record);
  await store.setJSON(key, existing);
}

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

function receiptEmailHtml({ name, amount, fundLabel, date, transactionId, siteUrl }) {
  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f5f3;color:#161616;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e6e6e4;">
      <div style="text-align:center;margin-bottom:28px;">
        <img src="${siteUrl}/logo-email.png" alt="The Walk" style="height:40px;width:auto;">
      </div>
      <p>Hi ${name || 'friend'},</p>
      <p>On <strong>${date}</strong> your gift to <strong>The Walk</strong> was made successfully.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">
        <tr><td style="padding:10px 0;color:#767a82;border-bottom:1px solid #eee;">Gift amount</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #eee;">$${amount}</td></tr>
        <tr><td style="padding:10px 0;color:#767a82;border-bottom:1px solid #eee;">Giving type</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #eee;">${fundLabel}</td></tr>
        <tr><td style="padding:10px 0;color:#767a82;">Transaction No.</td><td style="padding:10px 0;text-align:right;">${transactionId}</td></tr>
      </table>
      <p style="font-size:12px;color:#767a82;">No goods or services were provided in exchange for this contribution other than intangible religious benefits. Please keep this email for your tax records.</p>
      <p style="font-size:12px;color:#767a82;margin-top:24px;">The Walk</p>
    </div>
  </div>`;
}

function thankYouEmailHtml({ name, siteUrl }) {
  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f5f3;color:#161616;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e6e6e4;">
      <div style="text-align:center;margin-bottom:28px;">
        <img src="${siteUrl}/logo-email.png" alt="The Walk" style="height:40px;width:auto;">
      </div>
      <h2 style="margin:0 0 20px;font-size:22px;">Thank you for walking with us 🙏</h2>
      <p>Hey ${name || 'friend'},</p>
      <p>We just wanted to take a second and say thank you. Your gift isn't just a transaction to us — it's you choosing to be part of what The Walk is doing, and that means a lot.</p>
      <p>Every dollar you give goes toward keeping this community going: the podcast, the gatherings, and the everyday work of pointing people back to Jesus. You're not just supporting a project — you're helping someone else find people to walk this road with.</p>
      <p style="margin-top:24px;">Grateful for you,<br><strong>The Walk Team</strong></p>
    </div>
  </div>`;
}

function failedPaymentAlertHtml({ email, amount, fundLabel, reason }) {
  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f5f3;color:#161616;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e6e6e4;">
      <h2 style="margin:0 0 16px;font-size:20px;color:#c0392b;">A recurring payment failed</h2>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:8px 0;color:#767a82;border-bottom:1px solid #eee;">Donor email</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee;">${email || 'unknown'}</td></tr>
        <tr><td style="padding:8px 0;color:#767a82;border-bottom:1px solid #eee;">Amount</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee;">$${amount}</td></tr>
        <tr><td style="padding:8px 0;color:#767a82;border-bottom:1px solid #eee;">Category</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee;">${fundLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#767a82;">Reason</td><td style="padding:8px 0;text-align:right;">${reason || 'card declined'}</td></tr>
      </table>
      <p style="font-size:13px;color:#767a82;margin-top:20px;">Stripe will automatically retry a few times. You may want to reach out to this donor if it keeps failing.</p>
    </div>
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
      const giftType = fullSession.metadata?.giftType;
      const desiredCents = parseInt(fullSession.metadata?.desiredCents, 10);
      const fundLabel = FUND_LABELS[fund] || 'General Fund';
      const date = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });

      // ---- Log the gift for the admin dashboard (source of truth for giving stats) ----
      try {
        await appendToDay('gifts', {
          email: email || null,
          amountCharged: parseFloat(amount),
          amountIntended: Number.isFinite(desiredCents) ? desiredCents / 100 : parseFloat(amount),
          fund: fund || 'general',
          giftType: giftType || 'one_time',
          ts: Date.now(),
        });
      } catch (logErr) {
        console.error('Could not log gift for admin dashboard:', logErr);
      }


      // ---- Log a subscription "created" event for the retention chart ----
      if ((giftType || fullSession.mode === 'subscription') && fullSession.subscription) {
        try {
          await appendToDay('subscriptions', {
            event: 'created',
            subscriptionId: fullSession.subscription,
            fund: fund || 'general',
            ts: Date.now(),
          });
        } catch (logErr) {
          console.error('Could not log subscription creation:', logErr);
        }
      }

      const siteUrl = process.env.SITE_URL || 'https://thewalk4god.com';

      if (email) {
        // Two separate emails, sent back to back
        await sendEmail({
          to: email,
          subject: 'Your Giving Receipt — The Walk',
          html: receiptEmailHtml({ name, amount, fundLabel, date, transactionId: session.id, siteUrl }),
        });

        await sendEmail({
          to: email,
          subject: 'Thank You for Giving!',
          html: thankYouEmailHtml({ name, siteUrl }),
        });
      } else {
        console.warn('No email found on session, skipping emails.');
      }
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
    }
  }

  // Recurring renewal charges don't fire checkout.session.completed again —
  // Stripe sends invoice.paid instead. Log those as gifts too so recurring
  // givers show up correctly in the dashboard after their first payment.
  if (stripeEvent.type === 'invoice.paid') {
    const invoice = stripeEvent.data.object;

    // Only handle subscription renewals, not the invoice tied to the very
    // first checkout (that one's already logged above).
    if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const fund = subscription.metadata?.fund;
        const giftType = subscription.metadata?.giftType || 'recurring';
        const desiredCents = parseInt(subscription.metadata?.desiredCents, 10);
        const amount = (invoice.amount_paid || 0) / 100;
        const email = invoice.customer_email;

        await appendToDay('gifts', {
          email: email || null,
          amountCharged: amount,
          amountIntended: Number.isFinite(desiredCents) ? desiredCents / 100 : amount,
          fund: fund || 'general',
          giftType,
          renewal: true,
          ts: Date.now(),
        });
      } catch (err) {
        console.error('Error processing invoice.paid:', err);
      }
    }
  }

  // A recurring giver canceled (or their subscription otherwise ended).
  // Logged for the retention chart.
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    try {
      await appendToDay('subscriptions', {
        event: 'canceled',
        subscriptionId: subscription.id,
        fund: subscription.metadata?.fund || 'general',
        ts: Date.now(),
      });
    } catch (err) {
      console.error('Error processing customer.subscription.deleted:', err);
    }
  }

  // A recurring charge failed (expired card, insufficient funds, etc).
  // Logged for the dashboard AND emailed to whoever should follow up.
  if (stripeEvent.type === 'invoice.payment_failed') {
    const invoice = stripeEvent.data.object;
    try {
      let fund = 'general';
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        fund = subscription.metadata?.fund || 'general';
      }
      const amount = ((invoice.amount_due || 0) / 100).toFixed(2);
      const email = invoice.customer_email;
      const reason = invoice.last_finalization_error?.message || 'Card declined';
      const fundLabel = FUND_LABELS[fund] || 'General Fund';

      await appendToDay('alerts', {
        type: 'payment_failed',
        email: email || null,
        amount: parseFloat(amount),
        fund,
        ts: Date.now(),
      });

      if (process.env.ALERT_EMAIL) {
        await sendEmail({
          to: process.env.ALERT_EMAIL,
          subject: 'A recurring gift payment failed — The Walk',
          html: failedPaymentAlertHtml({ email, amount, fundLabel, reason }),
        });
      }
    } catch (err) {
      console.error('Error processing invoice.payment_failed:', err);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
