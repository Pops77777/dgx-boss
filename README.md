# DGx Boss — VIP AI Workspace & OpenAI-Compatible API

Ultra-luxury AI Chat & Image Studio powered by DGx Unlimited models.

## Features
- **VIP Chat Models:** Claude Opus 5.5, GPT-6 Astra, Claude Sonnet 5, Sol, Terra, GLM 5.2, Kimi K3, and uncensored models.
- **DGx AI Art:** Puter & Pollinations Turbo image generation.
- **OpenAI Compatible Endpoints:**
  - `POST /v1/chat/completions`
  - `GET /v1/models`
  - `POST /v1/images/generations`
- **Zero external dependencies:** Pure Node.js standard library.

## Deploy on Render
1. Push this repository to GitHub.
2. Go to [render.com](https://render.com) and click **New + -> Web Service**.
3. Select your GitHub repository.
4. Settings:
   - **Runtime:** `Node`
   - **Build Command:** *(leave empty)*
   - **Start Command:** `node server.js`
5. Click **Deploy Web Service**.
