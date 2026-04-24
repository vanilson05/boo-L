import express from "express";
import { writeFileSync, existsSync, unlinkSync } from "fs";

const app = express();
const PORTA = 3000;
const ARQUIVO_PAUSA = "./pausado.txt";

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  const pausado = existsSync(ARQUIVO_PAUSA);
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot L Farias</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #f0f0f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 20px; padding: 40px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 320px; }
    .logo { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 8px; }
    .status { font-size: 16px; margin-bottom: 30px; padding: 10px; border-radius: 8px; }
    .status.on { color: #25D366; background: #f0fff4; }
    .status.off { color: #e74c3c; background: #fff5f5; }
    .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: middle; }
    .dot.on { background: #25D366; animation: pulse 1.5s infinite; }
    .dot.off { background: #e74c3c; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .btn { width: 100%; padding: 18px; border: none; border-radius: 12px; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.2s; margin-top: 10px; }
    .btn.ligar { background: #25D366; color: white; }
    .btn.pausar { background: #e74c3c; color: white; }
    .btn:active { transform: scale(0.97); opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🤖 Bot L Farias</div>
    <div class="status ${pausado ? 'off' : 'on'}">
      <span class="dot ${pausado ? 'off' : 'on'}"></span>
      ${pausado ? '⏸️ Bot pausado' : '✅ Bot ativo'}
    </div>
    <form method="POST" action="/toggle">
      <button class="btn ${pausado ? 'ligar' : 'pausar'}">
        ${pausado ? '▶️ Ligar bot' : '⏸️ Pausar bot'}
      </button>
    </form>
  </div>
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
  console.log(`🎛️  Painel: http://SEU-IP-VPS:${PORTA}`);
});
