import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import Anthropic from "@anthropic-ai/sdk";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { JSONFilePreset } from "lowdb/node";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌ Defina ANTHROPIC_API_KEY no terminal");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ID do grupo para relatórios
const GRUPO_ID = "120363425619142357@g.us";
let botPausado = false;

const db = await JSONFilePreset("agendamentos.json", {
  agendamentos: [],
  fila_fds: [],
  audios_pendentes: []
});

function salvarAgendamento(telefone, nome, tipo, detalhe) {
  const reg = {
    id: Date.now(),
    criado_em: new Date().toLocaleString("pt-BR", { timeZone: "America/Maceio" }),
    telefone, nome, tipo, detalhe, status: "pendente",
  };
  db.data.agendamentos.push(reg);
  db.write();
  return reg;
}

function salvarAudioPendente(telefone) {
  const jaExiste = db.data.audios_pendentes.find(a => a.telefone === telefone);
  if (!jaExiste) {
    db.data.audios_pendentes.push({
      telefone,
      recebido_em: new Date().toLocaleString("pt-BR", { timeZone: "America/Maceio" })
    });
    db.write();
  }
}

function salvarFilaFDS(telefone) {
  if (!db.data.fila_fds) db.data.fila_fds = [];
  const jaExiste = db.data.fila_fds.find(f => f.telefone === telefone);
  if (!jaExiste) {
    db.data.fila_fds.push({ telefone, tentou_em: new Date().toLocaleString("pt-BR", { timeZone: "America/Maceio" }) });
    db.write();
  }
}

function limparFilaFDS() {
  db.data.fila_fds = [];
  db.write();
}

const historicos = new Map();
const ultimaAtividade = new Map();
const filaProcessamento = new Map();
let fdsJaEnviado = false;

function getHistorico(tel) {
  if (!historicos.has(tel)) historicos.set(tel, []);
  return historicos.get(tel);
}

setInterval(() => {
  const agora = Date.now();
  for (const [tel, t] of ultimaAtividade)
    if (agora - t > 7200000) { historicos.delete(tel); ultimaAtividade.delete(tel); }
}, 600000);

function getInfoHorario() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Maceio",
    weekday: "long",
    hour: "numeric",
    hour12: false
  }).formatToParts(agora);
  const diaSemana = partes.find(p => p.type === "weekday")?.value;
  const hora = parseInt(partes.find(p => p.type === "hour")?.value);
  return { diaSemana, hora };
}

// Segunda a sábado: 8h-17h
function isDentroDoHorario() {
  const { diaSemana, hora } = getInfoHorario();
  if (diaSemana === "domingo") return false;
  const diasAtivos = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  if (!diasAtivos.includes(diaSemana)) return false;
  return hora >= 8 && hora < 17;
}

function isSegundaManha() {
  const { diaSemana, hora } = getInfoHorario();
  return diaSemana === "segunda-feira" && hora === 8;
}

function buildSystemPrompt() {
  const horaAL = ((new Date().getUTCHours() - 3) + 24) % 24;
  return `Você representa o negócio de Lucas Farias em Canapi, Alagoas. Converse de forma totalmente natural, simples e descontraída, como uma pessoa real no WhatsApp. NUNCA se apresente como assistente, robô ou IA.

## FUSO HORÁRIO
Horário atual em Alagoas: ${horaAL}h (UTC-3). SEMPRE use esse fuso para saudação correta.

## NOME DO CLIENTE — REGRA IMPORTANTE
NUNCA assuma o nome da pessoa que está falando. Você só sabe o nome do cliente se ele disse explicitamente "meu nome é X" ou "sou X" em resposta a uma pergunta sua. Se alguém mencionar um nome qualquer sem dizer que é o próprio nome, NÃO assuma que é o nome dela.

## SOBRE O RESPONSÁVEL
Quando precisar encaminhar para atendimento presencial, diga apenas "passa no escritório" ou "o responsável entra em contato". NUNCA mencione nomes. Se perguntarem sobre o responsável, disponibilidade ou horário dele, diga apenas: "Passa no escritório que te atendemos 😊"

## LINKS E CONTEÚDO EXTERNO
Se alguém mandar link (Instagram, YouTube, sites etc.), ignore completamente e responda: "Aqui é o atendimento da L Farias 😊 Posso te ajudar com loteamento ou locação de equipamentos?"

## INTERPRETAÇÃO DE MENSAGENS
Você é MUITO bom em interpretar mensagens com erros, abreviações e gírias:
- "qto csta a beto" → betoneira | "tem retro livre" → retroescavadeira | "tô devend" → parcelas atrasadas | "qro um lot" → lote
- "e oq" ou "e ai" → contexto anterior | "pode sê" → confirmação | "ta caro" → não negocie, escritório
Só peça pra explicar se for ABSOLUTAMENTE impossível entender.

## DADOS DO CLIENTE
NUNCA peça telefone nem CPF. Só peça o NOME quando necessário.

## SAUDAÇÃO INICIAL
- Das 5h às 11h59: "Bom dia! 😊 Em que posso te ajudar?"
- Das 12h às 17h59: "Boa tarde! 😊 Em que posso te ajudar?"
- Das 18h às 4h59: "Boa noite! 😊 Em que posso te ajudar?"

## LOTEAMENTO CONVIVER — Canapi, AL
1. Pergunte se é em Canapi que está procurando
2. Se confirmar, diga que temos lotes disponíveis e convide para visita
3. Informe que a entrada é de R$ 200. NUNCA cite outros valores. Se perguntarem mais, diga que na visita explica tudo.
4. Após atender: "Se quiser mais informações, dá uma olhada aqui 😊" e depois: [LINK:https://lfarias.netlify.app/paginas/enprende]

AGENDAMENTO DE VISITA:
- Atendimento: segunda a sábado, das 8h às 17h
- Se sugerir domingo ou horário fora (após 17h ou antes de 8h): "As visitas são de segunda a sábado, das 8h às 17h 😊 Tem algum horário que funciona pra você?"
- Ao receber nome + dia/hora válidos: "Perfeito! Vou deixar anotado e o responsável confirma com você pelo WhatsApp 👍" e salve: [AGENDAR:visita_terreno|NOME|dia e horário]

## CARNÊ / PARCELAS ATRASADAS
Quando o cliente falar sobre parcelas ou carnê atrasado:
1. Não informe valores nem quantidade de parcelas
2. Peça o NOME, CPF e RG do cliente para o responsável poder verificar
3. Informe que ele pode também ir pessoalmente ao escritório para ser atendido e ver a melhor forma de resolver
4. Quando tiver nome + CPF + RG: [AGENDAR:pagamento_atrasado|NOME|CPF: XXX RG: XXX]
5. Diga: "Anotei! O responsável verifica e entra em contato em breve 👍 Se preferir, pode passar no escritório pessoalmente que a gente resolve da melhor forma 😊"

## EQUIPAMENTOS PARA LOCAÇÃO
MÁQUINAS PESADAS:
- Retroescavadeira: Diária R$1.500 | Semana R$7.000 | Quinzena R$12.500 | Mês R$18.000
- Caminhão Basculante: Diária R$1.200 | Semana R$6.000 | Quinzena R$10.000 | Mês R$15.000
- Compactador: Diária R$150 | Semana R$450 | Quinzena R$800 | Mês R$1.350

FERRAMENTAS:
- Compressor Pneumático: Diária R$700 | Semana R$3.000 | Quinzena R$4.000 | Mês R$6.000
- Betoneira: Diária R$120 | Semana R$270 | Quinzena R$320 | Mês R$450
- Martelo Rompedor: Diária R$40 | Semana R$150 | Quinzena R$250 | Mês R$400
- Serra Mármore: Diária R$30 | Semana R$80 | Quinzena R$150 | Mês R$200
- Cortador Manual: Diária R$20 | Semana R$60 | Quinzena R$100 | Mês R$150
- Esmerilhadeira: Diária R$30 | Semana R$80 | Quinzena R$150 | Mês R$200
- Vibrador de Concreto: Diária R$40 | Semana R$100 | Quinzena R$160 | Mês R$250
- Roçadeira: Diária R$150 | Semana R$480 | Quinzena R$900 | Mês R$1.500
- Soprador: Diária R$80 | Semana R$160 | Quinzena R$250 | Mês R$350
- Gerador: Diária R$80 | Semana R$160 | Quinzena R$250 | Mês R$350
- Inversora de Solda: Diária R$30 | Semana R$80 | Quinzena R$150 | Mês R$200
- Lavadora de Alta Pressão: Diária R$20 | Semana R$60 | Quinzena R$80 | Mês R$100
- Carrinho de Mão: Diária R$20 | Semana R$60 | Quinzena R$80 | Mês R$100
- Furadeira: Diária R$15 | Semana R$50 | Quinzena R$70 | Mês R$90
- Bomba Periférica: Diária R$30 | Semana R$70 | Quinzena R$120 | Mês R$150
- Bomba de Alta Pressão: Diária R$30 | Semana R$80 | Quinzena R$150 | Mês R$200
- Cinta 3.000kg: Diária R$10 | Semana R$15 | Quinzena R$20 | Mês R$25
- Cinta 500kg: Diária R$2 | Semana R$10 | Quinzena R$15 | Mês R$20
- Cabo de Chupeta: Diária R$10 | Semana R$15 | Quinzena R$20 | Mês R$25
- Kit Soquetes Tramontina: Diária R$15 | Semana R$20 | Quinzena R$30 | Mês R$40

ESTRUTURAS (por unidade):
- Andaime: Diária R$3 | Semana R$10 | Quinzena R$17 | Mês R$25
- Plataforma: Diária R$5 | Semana R$15 | Quinzena R$25 | Mês R$30
- Trava Diagonal: Diária R$1,50 | Semana R$7 | Quinzena R$10 | Mês R$15
- Sapatas: Diária R$1,50 | Semana R$7 | Quinzena R$10 | Mês R$15
- Roldanas: Diária R$2 | Semana R$10 | Quinzena R$15 | Mês R$20
- Escoras: Diária R$3 | Semana R$15 | Quinzena R$17 | Mês R$20
- Escada Pequena: Diária R$5 | Semana R$10 | Quinzena R$15 | Mês R$20

Após atender: "Dá uma olhada também nos outros equipamentos disponíveis 😊" e: [LINK:https://lfarias.netlify.app/loca%C3%A7%C3%A3o-web/index.html]
Ao confirmar locação: [AGENDAR:locacao_equipamento|NOME|equipamento e período]

## LOCALIZAÇÃO DO ESCRITÓRIO
Quando alguém perguntar onde fica, o endereço ou como chegar:
1. Mande o endereço: "Av. Joaquim Tetê, S/N - Centro, Canapi - AL 😊"
2. Depois numa mensagem separada mande o link do mapa: [LINK:https://maps.app.goo.gl/EoUFU5EJcXL1gCvz7]

## REGRAS GERAIS
- Curto e direto. Sem listas longas. Sem asteriscos.
- Desconto: "Sobre isso você precisa passar no escritório pessoalmente 😊"
- Períodos especiais (ex 3 dias): multiplique pela diária
- Mensagem pessoal: "Aqui é o atendimento da L Farias 😊 Posso te ajudar com loteamento ou locação?"

## TAGS (invisíveis ao cliente)
- [AGENDAR:tipo|nome|detalhe]
- [LINK:url]`;
}

async function chamarIA(telefone, texto) {
  const hist = getHistorico(telefone);
  hist.push({ role: "user", content: texto });
  ultimaAtividade.set(telefone, Date.now());
  if (hist.length > 20) hist.splice(0, hist.length - 20);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: hist,
  });

  const completa = response.content[0].text;

  const tagAgendamento = completa.match(/\[AGENDAR:([^\]]+)\]/);
  let agendamento = null;
  if (tagAgendamento) {
    const p = tagAgendamento[1].split("|");
    agendamento = { tipo: p[0]?.trim()||"outro", nome: p[1]?.trim()||"não informado", detalhe: p[2]?.trim()||"" };
  }

  const tagLink = completa.match(/\[LINK:([^\]]+)\]/);
  let linkSeparado = null;
  if (tagLink) linkSeparado = tagLink[1].trim();

  const limpo = completa.replace(/\[AGENDAR:[^\]]+\]/g, "").replace(/\[LINK:[^\]]+\]/g, "").trim();
  hist.push({ role: "assistant", content: limpo });
  return { texto: limpo, agendamento, linkSeparado };
}

async function processarMensagens(sock, telefone, mensagens) {
  const textoCompleto = mensagens.join("\n");
  try {
    await sock.sendPresenceUpdate("composing", telefone);
    const { texto: resposta, agendamento, linkSeparado } = await chamarIA(telefone, textoCompleto);

    if (agendamento) {
      const r = salvarAgendamento(telefone, agendamento.nome, agendamento.tipo, agendamento.detalhe);
      console.log(`📅 Agendamento #${r.id}: [${agendamento.tipo}] ${agendamento.nome}`);
    }

    await sock.sendMessage(telefone, { text: resposta });

    if (linkSeparado) {
      await new Promise(r => setTimeout(r, 1000));
      await sock.sendMessage(telefone, { text: linkSeparado });
    }

    console.log(`✉️  Enviado para ${telefone}`);
  } catch (e) { console.error("❌ Erro:", e.message); }
}

async function enviarRelatorio(sock) {
  try {
    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Maceio" });
    const agendamentos = db.data.agendamentos || [];
    const audios = db.data.audios_pendentes || [];

    // Pega agendamentos das últimas 4 horas
    const quatroHoras = Date.now() - (4 * 60 * 60 * 1000);
    const recentes = agendamentos.filter(a => a.id > quatroHoras);

    let msg = `📊 *Relatório L Farias* — ${agora}\n\n`;

    if (recentes.length === 0 && audios.length === 0) {
      msg += "Nenhuma atividade nas últimas 4 horas.";
    } else {
      if (recentes.length > 0) {
        msg += `📅 *Agendamentos (${recentes.length}):*\n`;
        for (const a of recentes) {
          const tipo = a.tipo === "visita_terreno" ? "Visita ao terreno" :
                       a.tipo === "pagamento_atrasado" ? "Carnê/Parcela" :
                       a.tipo === "locacao_equipamento" ? "Locação" : "Outro";
          const num = a.telefone.replace("@lid", "").replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "");
          msg += `• ${tipo}: ${a.nome} — ${a.detalhe}\n`;
          msg += `  https://wa.me/55${num}\n`;
        }
      }

      if (audios.length > 0) {
        msg += `\n🎤 *Áudios sem atendimento (${audios.length}):*\n`;
        for (const a of audios) {
          const numAudio = a.telefone.replace("@lid", "").replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "");
          msg += `• https://wa.me/55${numAudio} — ${a.recebido_em}\n`;
        }
        // Limpa lista de áudios após relatório
        db.data.audios_pendentes = [];
        db.write();
      }
    }

    await sock.sendMessage(GRUPO_ID, { text: msg });
    console.log("📊 Relatório enviado ao grupo");
  } catch (e) {
    console.error("❌ Erro ao enviar relatório:", e.message);
  }
}

async function enviarMensagensFDS(sock) {
  const fila = db.data.fila_fds || [];
  if (fila.length === 0 || fdsJaEnviado) return;
  fdsJaEnviado = true;
  console.log(`📬 Enviando mensagens para ${fila.length} pessoa(s) do fim de semana...`);
  for (const item of fila) {
    try {
      await sock.sendMessage(item.telefone, {
        text: "Bom dia! 😊 Vi que você tentou falar comigo no fim de semana. Como posso te ajudar?"
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error(`❌ Erro:`, e.message); }
  }
  limparFilaFDS();
  setTimeout(() => { fdsJaEnviado = false; }, 3600000);
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["LFarias Bot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log("\n📱 Escaneie o QR Code:\n"); qrcode.generate(qr, { small: true }); }
    if (connection === "close") {
      const cod = lastDisconnect?.error?.output?.statusCode;
      if (cod !== DisconnectReason.loggedOut) { console.log("🔄 Reconectando..."); setTimeout(iniciarBot, 3000); }
      else console.log("🚪 Deslogado. Rode novamente.");
    }
    if (connection === "open") {
      console.log("✅ Bot conectado!");
      if (isSegundaManha()) enviarMensagensFDS(sock);
    }
  });

  // Relatório a cada 4 horas
  setInterval(() => enviarRelatorio(sock), 4 * 60 * 60 * 1000);

  // Segunda às 8h: mensagens do fim de semana
  setInterval(() => {
    if (isSegundaManha()) enviarMensagensFDS(sock);
  }, 60000);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // Verificar comandos do grupo PRIMEIRO (aceita mensagens próprias)
      if (msg.key.remoteJid.endsWith("@g.us")) {
        if (msg.key.remoteJid === GRUPO_ID) {
          const txtGrupo = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          if (txtGrupo && txtGrupo.trim() === "/pausar") {
            botPausado = true;
            await sock.sendMessage(GRUPO_ID, { text: "⏸️ Bot pausado! Mande /ligar para voltar." });
            console.log("⏸️ Bot pausado via grupo");
          } else if (txtGrupo && txtGrupo.trim() === "/ligar") {
            botPausado = false;
            await sock.sendMessage(GRUPO_ID, { text: "▶️ Bot ligado! Voltando a responder normalmente." });
            console.log("▶️ Bot ligado via grupo");
          }
        }
        continue;
      }

      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith("@newsletter")) continue;

      const telefone = msg.key.remoteJid;
      const tipoMensagem = Object.keys(msg.message || {})[0];
      const isAudio = tipoMensagem === "audioMessage" || tipoMensagem === "pttMessage";

      // Bot pausado — ignora mensagens
      if (botPausado) {
        console.log(`⏸️ Bot pausado — mensagem de ${telefone} ignorada`);
        continue;
      }

      // Áudio — salva para relatório e ignora
      if (isAudio) {
        salvarAudioPendente(telefone);
        console.log(`🎤 Áudio salvo de ${telefone}`);
        continue;
      }

      // Fora do horário
      if (!isDentroDoHorario()) {
        salvarFilaFDS(telefone);
        console.log(`📵 Fora do horário — ${telefone} salvo`);
        continue;
      }

      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption;

      if (!texto) continue;

      console.log(`📨 [${telefone}]: ${texto}`);

      if (!filaProcessamento.has(telefone)) filaProcessamento.set(telefone, []);
      filaProcessamento.get(telefone).push(texto);

      if (filaProcessamento.get(telefone).timer) {
        clearTimeout(filaProcessamento.get(telefone).timer);
      }

      const timer = setTimeout(async () => {
        const pendentes = [...filaProcessamento.get(telefone)].filter(m => typeof m === "string");
        filaProcessamento.delete(telefone);
        if (pendentes.length > 0) await processarMensagens(sock, telefone, pendentes);
      }, 3000);

      filaProcessamento.get(telefone).timer = timer;
    }
  });
}

console.log("🤖 Bot L Farias iniciando...");
iniciarBot();