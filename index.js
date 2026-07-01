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
import { existsSync, rmSync } from "fs";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌ Defina ANTHROPIC_API_KEY no terminal");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const GRUPO_ID = "120363425619142357@g.us";
const ARQUIVO_PAUSA = "./pausado.txt";
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
  if (!db.data.audios_pendentes) db.data.audios_pendentes = [];
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
const contatosConhecidos = new Set();
let fdsJaEnviado = false;
let authResetInProgress = false;

function getHistorico(tel) {
  if (!historicos.has(tel)) historicos.set(tel, []);
  return historicos.get(tel);
}

setInterval(() => {
  const agora = Date.now();
  for (const [tel, t] of ultimaAtividade)
    if (agora - t > 7200000) { historicos.delete(tel); ultimaAtividade.delete(tel); }
}, 600000);

function isDentroDoHorario() {
  return true;
}

function isSegundaManha() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Maceio",
    weekday: "long",
    hour: "numeric",
    hour12: false
  }).formatToParts(agora);
  const diaSemana = partes.find(p => p.type === "weekday")?.value;
  const hora = parseInt(partes.find(p => p.type === "hour")?.value);
  return diaSemana === "segunda-feira" && hora === 8;
}

function detectarOutrosServicos(texto) {
  if (!texto) return null;
  const t = texto.toLowerCase();
  if (/\b(servi[cç]o|obra|reforma|constru[cç][aã]o|material|materiais|projeto|or[cç]amento|instala[cç][aã]o|manuten[cç][aã]o)\b/.test(t)) {
    return { tipo: "outros_servicos", detalhe: "demanda de outros serviços" };
  }
  return null;
}

function detectarFornecedorVendedor(texto) {
  if (!texto) return null;
  const t = texto.toLowerCase();
  if (/\b(fornecedor|fornecedora|vendedor|vendedora|revenda|representante|proposta|cotac[aã]o|cat[aá]logo|fornecimento|parceria)\b/.test(t)) {
    return { tipo: "fornecedor_vendedor", detalhe: texto.trim().slice(0, 120) };
  }
  return null;
}

function buildSystemPrompt() {
  const horaAL = ((new Date().getUTCHours() - 3) + 24) % 24;
  return `Você representa o negócio de Lucas Farias em Canapi, Alagoas. Converse de forma cordial, educada e um pouco mais formal, mas ainda natural e próxima — como um bom atendente no WhatsApp. NUNCA se apresente como assistente, robô ou IA.

## ATENDIMENTO PADRÃO
Em toda conversa, comece de forma acolhedora e natural, como um atendimento humano. Sempre que não houver uma regra específica, responda com uma saudação curta, diga que é o atendente da L Farias e pergunte como pode ajudar. Exemplo: "Olá! 😊 Sou o atendente da L Farias, como posso te ajudar?"

## FUSO HORÁRIO
Horário atual em Alagoas: ${horaAL}h (UTC-3). SEMPRE use esse fuso para saudação correta.

## IDENTIDADE
Se alguém perguntar seu nome, quem está atendendo ou se apresentar, diga que é o atendente da L Farias e pergunte como pode ajudar.

## SOBRE O LUCAS — REGRA MAIS IMPORTANTE DO PROMPT
Qualquer mensagem que contenha o nome "Lucas" — seja "boa tarde Lucas", "Lucas tem terreno?", "lucas esta?", "oi Lucas", "quero falar com Lucas", "obrigado Lucas" — você DEVE responder EXATAMENTE assim:

"Agradecemos o seu contato! 😊 O Lucas não está disponível no momento. Caso queira continuar o atendimento, sou o atendente da L Farias e posso te ajudar."

REGRAS:
- NUNCA comece com saudação antes
- NUNCA responda a pergunta antes de dar essa mensagem
- NUNCA pergunte "você quer falar com o Lucas?"

## NOME DO CLIENTE
NUNCA assuma o nome da pessoa. Só sabe o nome se ele disse explicitamente.

## LINKS EXTERNOS
Se alguém mandar link, ignore e responda: "Aqui é o atendimento da L Farias 😊 Posso te ajudar com loteamento ou locação de equipamentos?"

## INTERPRETAÇÃO
Interprete erros, abreviações e gírias. Só peça pra explicar se for impossível entender.

## DADOS DO CLIENTE
NUNCA peça telefone nem CPF.

## SAUDAÇÃO INICIAL
- Das 5h às 11h59: "Bom dia! 😊 Em que posso te ajudar?"
- Das 12h às 17h59: "Boa tarde! 😊 Em que posso te ajudar?"
- Das 18h às 4h59: "Boa noite! 😊 Em que posso te ajudar?"

## PASSAR PARA SETOR RESPONSÁVEL — REGRA IMPORTANTE
Se o cliente:
- Pedir informações muito detalhadas além do básico (condições especiais, negociação, financiamento)
- Perguntar coisas que você não consegue responder com certeza
- Precisar de uma análise personalizada da situação dele

Responda: "Entendido! 😊 Vou encaminhar sua solicitação para o setor responsável, que poderá lhe auxiliar melhor. Em breve entrarão em contato 👍"
E salve: [AGENDAR:encaminhamento_setor|NOME se souber|motivo resumido]

## LOTEAMENTO CONVIVER — Canapi, AL
Trabalhamos com lotes APENAS em Canapi/AL.
1. Informe que temos lotes disponíveis no Loteamento Conviver em Canapi
2. Entrada de R$ 200. NUNCA cite outros valores ou parcelas.
3. NUNCA marque visita, horário ou dia — isso é EXCLUSIVO do responsável
4. Se o cliente quiser mais informações, diga: "Vou passar para o responsável que poderá te auxiliar melhor com todos os detalhes 😊"
5. Após atender: [LINK:https://lfarias.netlify.app/paginas/enprende]
6. Registre o interesse: [AGENDAR:visita_terreno|NOME se souber|interesse em lote]

## EQUIPAMENTOS — REGRAS DE LOCAÇÃO — MUITO IMPORTANTE
NUNCA confirme disponibilidade. NUNCA marque data, horário ou local de entrega. NUNCA diga que o equipamento está disponível. Isso é EXCLUSIVO do responsável.

## OUTROS SERVIÇOS / OBRAS / MATERIAIS
Se o cliente falar sobre serviço, obra, reforma, construção, material, projeto, orçamento ou instalação:
1. Responda: "Entendido! 😊 Vou encaminhar sua solicitação para o setor responsável, que poderá te ajudar melhor com esse assunto. Em breve entrarão em contato 👍"
2. Salve: [AGENDAR:outros_servicos|NOME se souber|assunto]

## FORNECEDORES E VENDEDORES
Se o cliente falar sobre fornecedor, vendedor, proposta, cotação, catálogo, parceria ou fornecimento:
1. NUNCA diga se quer ou não. NUNCA ofereça loteamento ou locação.
2. Responda de forma acolhedora e objetiva: "Olá! 😊 Sou o Jeferson. Vou encaminhar sua proposta para o responsável. Por favor, envie a proposta detalhada aqui na conversa e aguarde o retorno do responsável. Obrigado pelo contato!"
3. Salve: [AGENDAR:fornecedor_vendedor|NOME se souber|proposta]

Se o cliente perguntar por um equipamento que NÃO está na lista abaixo, NÃO informe preço, NÃO diga que temos e NÃO diga que não temos.
Responda apenas: "Certo! 😊 Vou passar para o responsável verificar isso e ele retorna por aqui assim que olhar."

Fluxo correto:
1. Cliente pergunta sobre equipamento → informe o preço
2. Se precisar de mais de 3 dias → sugira a semana: "Vale mais a pena alugar a semana, fica mais em conta 😊"
3. Pergunte apenas o período desejado
4. Após saber o período → diga: "Certo! Vou passar para o responsável verificar a disponibilidade e entrar em contato para combinar os detalhes 😊" + [AGENDAR:locacao_equipamento|NOME se souber|equipamento e período]

## ESTRATÉGIA DE VENDAS — EQUIPAMENTOS COMPLEMENTARES
Sugira com educação um complementar. Só uma vez, sem insistir:
- Andaime → Plataforma e Travas Diagonais
- Betoneira → pergunte a finalidade → Vibrador de Concreto (concretagem) ou Compactador (piso)
- Compressor → Martelo Rompedor
- Roçadeira → Soprador
- Retroescavadeira → Compactador

## CARNÊ / PARCELAS ATRASADAS
Quando o cliente perguntar sobre carnê, parcelas, consulta de débito ou situação do contrato:
1. NUNCA peça nome, CPF, RG ou qualquer dado
2. Responda: "Confirmado! 😊 Já registramos sua solicitação. O responsável irá verificar e retornará para o senhor(a) em breve. Por favor, aguarde."
3. Salve: [AGENDAR:pagamento_atrasado|não informado|cliente solicitou consulta de carnê/parcelas]

## EQUIPAMENTOS
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

Após atender equipamentos: [LINK:https://lfarias.netlify.app/loca%C3%A7%C3%A3o-web/index.html]

## LOCALIZAÇÃO
Quando perguntar onde fica:
1. "Av. Joaquim Tetê, S/N - Centro, Canapi - AL 😊"
2. [LINK:https://maps.app.goo.gl/EoUFU5EJcXL1gCvz7]

## REGRAS GERAIS
- Curto e direto. Sem listas longas.
- Desconto: "Sobre isso o responsável poderá te informar melhor 😊"
- Períodos especiais: multiplique pela diária
- Mensagem pessoal: "Aqui é o atendimento da L Farias 😊"

## TAGS
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

async function verificarComprovante(sock, msg, telefone) {
  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
    const base64 = buffer.toString("base64");
    const mediaType = msg.message.imageMessage.mimetype || "image/jpeg";
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Essa imagem é um comprovante de pagamento ou transferência bancária? Responda apenas: SIM ou NAO" }
        ]
      }]
    });
    return response.content[0].text.trim().toUpperCase().includes("SIM");
  } catch (e) {
    console.error("❌ Erro ao verificar imagem:", e.message);
    return false;
  }
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
            a.tipo === "locacao_equipamento" ? "Locação" :
            a.tipo === "comprovante_pagamento" ? "Comprovante" :
            a.tipo === "outros_servicos" ? "Outros serviços" :
            a.tipo === "fornecedor_vendedor" ? "Fornecedor/Vendedor" :
            a.tipo === "atendimento_humano" ? "⚠️ Atendimento humano" : "Outro";
          const num = a.telefone.replace("@lid","").replace("@s.whatsapp.net","").replace(/[^0-9]/g,"");
          msg += `• ${tipo}: ${a.nome} — ${a.detalhe}\n`;
          msg += `  https://wa.me/55${num}\n`;
        }
      }
      if (audios.length > 0) {
        msg += `\n🎤 *Áudios sem atendimento (${audios.length}):*\n`;
        for (const a of audios) {
          const numAudio = a.telefone.replace("@lid","").replace("@s.whatsapp.net","").replace(/[^0-9]/g,"");
          msg += `• https://wa.me/55${numAudio} — ${a.recebido_em}\n`;
        }
        db.data.audios_pendentes = [];
        db.write();
      }
    }
    await sock.sendMessage(GRUPO_ID, { text: msg });
    console.log("📊 Relatório enviado ao grupo");
  } catch (e) { console.error("❌ Erro ao enviar relatório:", e.message); }
}

async function enviarMensagensFDS(sock) {
  const fila = db.data.fila_fds || [];
  if (fila.length === 0 || fdsJaEnviado) return;
  fdsJaEnviado = true;
  for (const item of fila) {
    try {
      await sock.sendMessage(item.telefone, { text: "Bom dia! 😊 Vi que você tentou falar comigo. Como posso te ajudar?" });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error(`❌ Erro:`, e.message); }
  }
  limparFilaFDS();
  setTimeout(() => { fdsJaEnviado = false; }, 3600000);
}

async function carregarHistoricoWhatsApp(sock, telefone) {
  try {
    if (historicos.has(telefone)) return;
    const msgs = await sock.fetchMessagesFromWA(telefone, 10);
    if (!msgs || msgs.length === 0) return;
    const hist = [];
    for (const m of msgs.reverse()) {
      const txt = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
      if (!txt) continue;
      hist.push({ role: m.key.fromMe ? "assistant" : "user", content: txt });
    }
    if (hist.length > 0) {
      historicos.set(telefone, hist);
      console.log(`📚 Histórico carregado para ${telefone}: ${hist.length} msgs`);
    }
  } catch (e) { /* silencioso */ }
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
      if (cod === DisconnectReason.loggedOut) {
        console.log("🔐 Sessão inválida ou deslogada. Limpando credenciais e iniciando nova autenticação...");
        if (!authResetInProgress) {
          authResetInProgress = true;
          try { rmSync("./auth_info", { recursive: true, force: true }); } catch (e) { console.error("❌ Não foi possível limpar auth_info:", e.message); }
          setTimeout(() => {
            authResetInProgress = false;
            iniciarBot();
          }, 3000);
        }
      } else {
        console.log("🔄 Reconectando...");
        setTimeout(iniciarBot, 3000);
      }
    }
    if (connection === "open") {
      console.log("✅ Bot conectado!");
      if (isSegundaManha()) enviarMensagensFDS(sock);
    }
  });

  setInterval(() => enviarRelatorio(sock), 4 * 60 * 60 * 1000);
  setInterval(() => { if (isSegundaManha()) enviarMensagensFDS(sock); }, 60000);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {

      if (msg.key.remoteJid.endsWith("@g.us")) {
        if (msg.key.remoteJid === GRUPO_ID) {
          const txtGrupo = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          if (txtGrupo && txtGrupo.trim() === "/pausar") {
            const { writeFileSync } = await import("fs");
            writeFileSync(ARQUIVO_PAUSA, "pausado");
            await sock.sendMessage(GRUPO_ID, { text: "⏸️ Bot pausado!" });
            console.log("⏸️ Bot pausado via grupo");
          } else if (txtGrupo && txtGrupo.trim() === "/ligar") {
            const { unlinkSync, existsSync: es } = await import("fs");
            if (es(ARQUIVO_PAUSA)) unlinkSync(ARQUIVO_PAUSA);
            await sock.sendMessage(GRUPO_ID, { text: "▶️ Bot ligado!" });
            console.log("▶️ Bot ligado via grupo");
          }
        }
        continue;
      }

      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.remoteJid.endsWith("@newsletter")) continue;

      const telefone = msg.key.remoteJid;
      const tipoMensagem = Object.keys(msg.message || {})[0];

      if (existsSync(ARQUIVO_PAUSA)) {
        console.log(`⏸️ Bot pausado — mensagem de ${telefone} ignorada`);
        continue;
      }

      if (tipoMensagem === "audioMessage" || tipoMensagem === "pttMessage") {
        salvarAudioPendente(telefone);
        console.log(`🎤 Áudio ignorado de ${telefone}`);
        continue;
      }

      if (tipoMensagem === "imageMessage") {
        console.log(`🖼️ Imagem recebida de ${telefone} — verificando...`);
        const isComprovante = await verificarComprovante(sock, msg, telefone);
        if (isComprovante) {
          await sock.sendMessage(telefone, {
            text: "Comprovante recebido! 😊 O responsável vai verificar e confirma com você em breve 👍"
          });
          salvarAgendamento(telefone, "não informado", "comprovante_pagamento", "comprovante recebido via imagem");
          console.log(`🧾 Comprovante salvo de ${telefone}`);
        } else {
          console.log(`🖼️ Imagem ignorada de ${telefone} — não é comprovante`);
        }
        continue;
      }

      const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (texto) {
        const fornecedorVendedor = detectarFornecedorVendedor(texto);
        if (fornecedorVendedor) {
          salvarAgendamento(telefone, "não informado", fornecedorVendedor.tipo, fornecedorVendedor.detalhe);
          await sock.sendMessage(telefone, {
            text: "Olá! 😊 Sou o atendente da L Farias. Vou encaminhar sua proposta para o responsável. Por favor, envie a proposta detalhada aqui na conversa e aguarde o retorno do responsável. Obrigado pelo contato!"
          });
          console.log(`🧾 Novo contato de fornecedor/vendedor de ${telefone}`);
          continue;
        }

        const outrosServicos = detectarOutrosServicos(texto);
        if (outrosServicos) {
          salvarAgendamento(telefone, "não informado", outrosServicos.tipo, outrosServicos.detalhe);
          await sock.sendMessage(telefone, {
            text: "Olá! 😊 Sou o atendente da L Farias. Vou encaminhar sua solicitação para o setor responsável, que poderá te ajudar melhor com esse assunto. Em breve entrarão em contato 👍"
          });
          console.log(`🧩 Novo atendimento de outros serviços de ${telefone}`);
          continue;
        }
      }

      if (!isDentroDoHorario()) {
        salvarFilaFDS(telefone);
        continue;
      }

      if (!texto) continue;

      console.log(`📨 [${telefone}]: ${texto}`);
      await carregarHistoricoWhatsApp(sock, telefone);

      if (!filaProcessamento.has(telefone)) filaProcessamento.set(telefone, []);
      const filaAtual = filaProcessamento.get(telefone);
      const ultimaMsg = filaAtual.filter(m => typeof m === "string").slice(-1)[0];
      if (ultimaMsg !== texto) filaAtual.push(texto);
      if (filaAtual.timer) clearTimeout(filaAtual.timer);

      const timer = setTimeout(async () => {
        const pendentes = [...filaProcessamento.get(telefone)].filter(m => typeof m === "string");
        filaProcessamento.delete(telefone);
        if (pendentes.length > 0) await processarMensagens(sock, telefone, pendentes);
      }, 3000);

      filaAtual.timer = timer;
    }
  });
}

console.log("🤖 Bot L Farias iniciando...");
iniciarBot();
