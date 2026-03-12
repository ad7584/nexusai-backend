# 🚀 NexusAI — AI Support Agent Platform

## Quick Start (3 steps)

### 1. Install
```bash
npm install
```

### 2. Start
```bash
npm start
```

### 3. Open
Go to **http://localhost:3000** in your browser.

That's it! Your AI agent platform is running.

---

## Create Your First Business

Open a new terminal and run:

```bash
curl -X POST http://localhost:3000/api/business/create ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"My Salon\",\"type\":\"Beauty Salon\",\"phone\":\"+91 98765 43210\",\"services\":[{\"name\":\"Haircut\",\"price\":500,\"duration\":\"30 min\",\"category\":\"Hair\"},{\"name\":\"Facial\",\"price\":1500,\"duration\":\"45 min\",\"category\":\"Skin\"}]}"
```

Or use Postman — POST to `http://localhost:3000/api/business/create`

Then refresh http://localhost:3000 — you'll see the chat widget!

---

## Deploy to Railway (free)

1. Push to GitHub
2. Go to railway.app → New Project → From GitHub
3. Add env variable: `GROQ_API_KEY` = your key
4. Generate a domain
5. Done — your bot is live on the internet

---

## Embed on Any Website

```html
<script src="https://YOUR-URL.com/widget.js" data-business="my-salon" async></script>
```

Replace YOUR-URL with your Railway/Render URL.
