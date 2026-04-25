# Translate VN 🇻🇳

Point your camera at Vietnamese text and see instant English translations overlaid directly on the image — like AR subtitles for the real world. Powered by **Groq + Llama 4 Scout** for fast vision inference.

## Features

- 📷 **Live camera** with tap-to-translate
- 🔄 **Auto mode** — scans every few seconds automatically
- 🖼️ **Gallery** — pick any photo from your phone
- 🔤 **AR overlay** — English translations painted over the original Vietnamese text in-place
- 📱 **Mobile-optimised** — works great on Android Chrome
- ⚡ **Groq-powered** — fast inference via Llama 4 Scout vision model

---

## Deploy to Vercel (5 minutes)

### 1. Get a Groq API Key (free)
Go to [console.groq.com](https://console.groq.com) → API Keys → Create Key.

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
gh repo create translate-vn --public --push
```

### 3. Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
2. Under **Environment Variables**, add:
   - Key: `GROQ_API_KEY`
   - Value: your key from step 1
3. Click **Deploy**

Open the Vercel URL on your Android phone in Chrome — done!

---

## Run locally

```bash
cp .env.example .env.local
# Edit .env.local and paste your GROQ_API_KEY

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How it works

1. You tap the screen or press 📷
2. The app freezes the frame and sends it to `/api/translate`
3. The server-side route sends it to **Groq** (`llama-4-scout-17b-16e-instruct`) asking for Vietnamese text bounding boxes as percentages
4. The frontend draws English translations directly over each text region on a canvas
5. Tap the image to dismiss and return to live camera

Your API key lives only on the server — never exposed to the browser.
