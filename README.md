# Give / Donation Form — Setup Guide

This gives you a full giving flow:
**give.html → verify-phone.html → verify-code.html → Stripe Checkout → give-success.html**

Your Stripe secret key and Twilio credentials never touch the browser — they live only in
Netlify's environment variables and are used inside serverless functions.

## Files
- `give.html` — the donation form (gift type, frequency, fund, amount)
- `verify-phone.html` — "enter your mobile number" step
- `verify-code.html` — "enter the code we texted you" step
- `give-success.html` — thank-you page after payment
- `netlify/functions/send-verification.js` — sends the SMS code via Twilio Verify
- `netlify/functions/check-verification.js` — checks the code the person typed
- `netlify/functions/create-checkout-session.js` — creates the Stripe Checkout session (only after phone is verified)
- `netlify.toml` — Netlify config
- `package.json` — declares the `stripe` and `twilio` npm packages the functions need

## 1. Set up Stripe (for payments)
See the Stripe steps from before: get your secret key from
**Stripe Dashboard → Developers → API keys**.

## 2. Set up Twilio (for the SMS code)
1. Sign up at https://www.twilio.com/try-twilio (free trial includes some SMS credit)
2. In the Twilio Console, go to **Verify → Services → Create new Service**
   (name it anything, e.g. "Walk 4 God Giving") — copy the **Service SID** (starts with `VA...`)
3. From the main Console dashboard, copy your **Account SID** and **Auth Token**

⚠️ Note: while on Twilio's free trial, you can only send codes to phone numbers you've manually
verified in the Twilio Console (**Phone Numbers → Verified Caller IDs**). To text *any* phone
number, you'll need to add a small amount of billing credit to your Twilio account.

## 3. Push these files to a GitHub repo
Create a new repo (e.g. `walk4god-give`) and add all files in this folder to it.

## 4. Connect the repo to Netlify
1. Go to https://app.netlify.com → **Add new site → Import an existing project**
2. Pick your repo
3. Build settings: leave build command empty, publish directory as `.` (already set in `netlify.toml`)
4. Deploy

## 5. Add your environment variables
In Netlify: **Site settings → Environment variables**, add:
- `STRIPE_SECRET_KEY` = your Stripe secret key
- `SITE_URL` = your live Netlify URL (e.g. `https://walk4god.netlify.app`)
- `TWILIO_ACCOUNT_SID` = from Twilio Console
- `TWILIO_AUTH_TOKEN` = from Twilio Console
- `TWILIO_VERIFY_SERVICE_SID` = the `VA...` Service SID you created in step 2

Redeploy after adding these (Netlify → Deploys → Trigger deploy).

## 6. Test it
- Visit `https://yoursite.netlify.app/give.html`
- Pick an amount → Next → enter your own verified phone number → you should receive a real text
  with a code → enter it → confirm → redirected to Stripe checkout
- Use Stripe's test card `4242 4242 4242 4242` (only works with your `sk_test_...` key)

## 7. Link the "Give" button on your main site
On your main `index.html`, point the Give button/link to:
```html
<a href="give.html">Give</a>
```

## Notes
- Recurring gifts only support **weekly** and **monthly** (Stripe's native subscription intervals).
- The $1 minimum is enforced both in the browser and again inside the checkout-session function.
- Phone verification currently only supports **US numbers** (+1, 10 digits). If you need
  international numbers, the phone input and validation regex in `send-verification.js` and
  `verify-phone.html` would need to be loosened.
- The phone number is currently just used to verify the person and is passed along as metadata
  on the Stripe Checkout session (search "phone" in `create-checkout-session.js`) — nothing is
  stored anywhere else unless you add that yourself.
