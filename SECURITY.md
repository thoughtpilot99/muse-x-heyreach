# Security

ReachGuard is a **local, single-user** app. Please keep it that way unless you add your own authentication.

## Your API keys
- Keys entered on the **Setup** page are stored in `data/app.db` on your machine. Keys in `.env.local` override them.
- Both `data/` and `.env*` (except `.env.example`) are gitignored. Never commit them, and never paste keys into issues or pull requests.
- If a key leaks, rotate it at the provider (Meta Model API, HeyReach) and paste the new one on the Setup page.

## Exposing the app (webhooks)
HeyReach webhooks need a public URL, usually a tunnel such as `cloudflared tunnel --url http://localhost:3000`. A tunnel makes the **whole UI** reachable, so:
1. Set `APP_PASSWORD` in `.env.local` **before** starting the tunnel. Every page except `/api/webhooks/*` then requires it.
2. The webhook only accepts requests carrying your secret token (`?token=…`, generated on the Setup page).

## Safety switches
- Live mode is **off** by default. Nothing is added to HeyReach and no LinkedIn message is sent until you turn it on in Setup (typed confirmation). `RG_LIVE_ENABLED=0` in `.env.local` forces it off.
- The safety governor caps volume per LinkedIn account and pauses campaigns when acceptance rates drop. It **lowers** the risk of LinkedIn restrictions but cannot remove it: automating LinkedIn is against LinkedIn's terms of service.
- Profile text and messages are passed to Muse Wonder as untrusted input.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository rather than a public issue.
