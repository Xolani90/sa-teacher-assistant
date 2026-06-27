# Prevent Render Cold Starts — UptimeRobot Setup

Render free tier sleeps after 15 minutes of inactivity. This causes ~30 second delays for teachers.
Fix: set up a free UptimeRobot monitor to ping the server every 14 minutes.

## Steps

1. Go to https://uptimerobot.com and create a free account
2. Click "Add New Monitor"
3. Monitor Type: HTTP(s)
4. Friendly Name: SA Teacher Assistant
5. URL: https://YOUR_RENDER_URL.onrender.com/health
6. Monitoring Interval: 14 minutes
7. Click "Create Monitor"

## Health endpoint

The app already exposes GET /health which returns 200 OK.
Use that URL as the ping target.

## Verify it works

After setup, check Render logs — you should see a GET /health request every 14 minutes.
If the /health endpoint does not exist in server.js, add this route:

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
