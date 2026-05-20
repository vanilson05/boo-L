import express from "express";
import { writeFileSync, existsSync, unlinkSync } from "fs";

const app = express();
const PORTA = 3000;
const ARQUIVO_PAUSA = "./pausado.txt";

app.use(express.urlencoded({ extended: true }));

app.get("/manifest.json", (req, res) => {
  res.json({
    name: "L Farias Bot",
    short_name: "LF Bot",
    description: "Painel de controle do bot L Farias",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ff8000",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" }
    ]
  });
});

app.get("/icon.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
    <rect width="192" height="192" rx="40" fill="#1a1a1a"/>
    <rect x="28" y="36" width="56" height="120" rx="6" fill="#ff8000"/>
    <rect x="28" y="124" width="120" height="32" rx="6" fill="#ff8000"/>
    <text x="44" y="118" font-size="80" font-family="Arial Black, Arial" font-weight="900" fill="white">L</text>
  </svg>`);
});

app.get("/sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`self.addEventListener('fetch', e => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });`);
});

app.get("/", (req, res) => {
  const pausado = existsSync(ARQUIVO_PAUSA);
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#ff8000">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="LF Bot">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icon.svg">
  <title>L Farias Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 24px;
      padding: 2.5rem 1.5rem 2rem;
      width: 100%;
      max-width: 340px;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
    }
    .logo-icon {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      background: #1a1a1a;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
      position: relative;
      overflow: hidden;
    }
    .logo-l {
      font-size: 42px;
      font-weight: 900;
      font-family: Arial Black, Arial, sans-serif;
      color: white;
      line-height: 1;
      position: relative;
      z-index: 2;
    }
    .logo-l span {
      display: inline-block;
      background: #ff8000;
      color: white;
      padding: 2px 6px 2px 4px;
      border-radius: 4px;
    }
    .empresa { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 2px; }
    .sub { font-size: 14px; color: #888; margin-bottom: 2rem; }

    .status-box {
      border-radius: 14px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 1.5rem;
      transition: all 0.3s;
    }
    .status-box.on { background: #e8f8ee; border: 1.5px solid #22c55e; }
    .status-box.off { background: #fef2f2; border: 1.5px solid #ef4444; }

    .dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.on { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.2); }
    .dot.off { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.2); }

    .status-text { font-size: 15px; font-weight: 600; }
    .status-text.on { color: #16a34a; }
    .status-text.off { color: #dc2626; }

    .btn {
      width: 100%;
      padding: 18px;
      border: none;
      border-radius: 14px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
      letter-spacing: 0.3px;
    }
    .btn.pausar {
      background: #ef4444;
      color: white;
    }
    .btn.pausar:active { background: #dc2626; transform: scale(0.97); }
    .btn.ligar {
      background: #22c55e;
      color: white;
    }
    .btn.ligar:active { background: #16a34a; transform: scale(0.97); }

    .btn-text { color: #ff8000; font-size: 13px; }

    .footer { margin-top: 1.5rem; font-size: 12px; color: #bbb; }

    .instalar {
      margin-top: 1rem;
      padding: 10px 14px;
      background: #fff3e6;
      border-radius: 10px;
      font-size: 12px;
      color: #ff8000;
      display: none;
      line-height: 1.5;
    }
    .instalar.show { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-icon">
      <div class="logo-l"><span>L</span></div>
    </div>
    <div class="empresa" style="color:#ff8000">L FARIAS</div>
    <div class="sub">Painel de atendimento</div>

    <div class="status-box ${pausado ? 'off' : 'on'}">
      <div class="dot ${pausado ? 'off' : 'on'}"></div>
      <span class="status-text ${pausado ? 'off' : 'on'}">
        ${pausado ? 'Bot pausado' : 'Bot ativo'}
      </span>
    </div>

    <form method="POST" action="/toggle">
      <button class="btn ${pausado ? 'ligar' : 'pausar'}" style="color:white">
        <span style="color:white">${pausado ? '▶ Ligar bot' : '⏸ Pausar bot'}</span>
      </button>
    </form>

    <div class="instalar" id="instalar">
      📱 Para instalar como app: toque em "Compartilhar" e depois "Adicionar à tela de início"
    </div>

    <div class="footer" style="color:#ff8000; margin-top:1rem; font-weight:500">L Farias Construções</div>
    <div class="footer">Canapi — AL</div>
  </div>

  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone;
    if (isIOS && !isStandalone) {
      document.getElementById('instalar').classList.add('show');
    }
  </script>
</body>
</html>`);
});

app.post("/toggle", (req, res) => {
  if (existsSync(ARQUIVO_PAUSA)) {
    unlinkSync(ARQUIVO_PAUSA);
    console.log("▶️ Bot ligado via painel");
  } else {
    writeFileSync(ARQUIVO_PAUSA, "pausado");
    console.log("⏸️ Bot pausado via painel");
  }
  res.redirect("/");
});

app.listen(PORTA, () => {
  console.log(`🎛️  Painel L Farias: http://localhost:${PORTA}`);
  console.log(`📱 Celular: http://SEU-IP:${PORTA}`);
});