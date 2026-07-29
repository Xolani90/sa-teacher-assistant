// Simulates a real, correctly-signed WhatsApp webhook delivery against your
// local backend, for testing flows (like NEW CLASS) without a live WhatsApp
// Business number to send from.
//
// Usage:
//   node simulate-webhook.js "NEW CLASS Grade 7A, 34"
//   node simulate-webhook.js "NEW CLASS Grade 7B, 30" 27782629774
//
// Run this from your repo root (same folder as .env) so it picks up
// META_APP_SECRET automatically.

require('dotenv').config();
const crypto = require('crypto');
const http = require('http');

const text = process.argv[2];
const from = process.argv[3] || '27782629774';

if (!text) {
  console.error('Usage: node simulate-webhook.js "<message text>" [fromPhone]');
  process.exit(1);
}

if (!process.env.META_APP_SECRET) {
  console.error('META_APP_SECRET not found in .env — cannot sign the request.');
  process.exit(1);
}

const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messages: [{
          id: `wamid.sim_${Date.now()}`,
          from,
          type: 'text',
          text: { body: text },
        }],
      },
    }],
  }],
};

const body = JSON.stringify(payload);

const signature = 'sha256=' + crypto
  .createHmac('sha256', process.env.META_APP_SECRET)
  .update(body)
  .digest('hex');

const req = http.request(
  {
    hostname: 'localhost',
    port: process.env.PORT || 3000,
    path: '/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Hub-Signature-256': signature,
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      console.log(`Response: ${data}`);
      console.log('\nCheck your backend terminal for [WEBHOOK] logs to confirm processing.');
    });
  }
);

req.on('error', (err) => {
  console.error('Request failed — is your backend running on this port?', err.message);
});

req.write(body);
req.end();
