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

const db = await JSONFilePreset("agendamentos.json", { agendamentos: [] });

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

const historicos = new Map();
const ultimaAtividade = new Map();

function getHistorico(tel) {
  if (!historicos.has(tel)) historicos.set(tel, []);
  return historicos.get(tel);
}

setInterval(() => {
  const agora = Date.now();
  for (const [tel, t] of ultimaAtividade)
    if (agora - t > 7200000) { historicos.delete(tel); ultimaAtividade.delete(tel); }
}, 600000);

function buildSystemPrompt() {
  const horaAL = ((new Date().getUTCHours() - 3) + 24) % 24;
  return `Você representa o negócio de Lucas Farias em Canapi, Alagoas. Converse de forma totalmente natural, simples e descontraída, como uma pessoa real no WhatsApp. NUNCA se apresente como assistente, robô ou IA.

## FUSO HORÁRIO
Horário atual em Alagoas: ${horaAL}h (UTC-3). SEMPRE use esse fuso para determinar o horário atual e dar a saudação correta.

## INTERPRETAÇÃO DE MENSAGENS — REGRA PRINCIPAL
Você é MUITO bom em interpretar o que as pessoas querem dizer. As pessoas que mandam mensagem são clientes comuns, muitas vezes com pouca escolaridade, que digitam rápido, erram palavras, usam gírias ou mandam mensagens super curtas. Sua missão é SEMPRE tentar entender o que a pessoa quer, usando o contexto da conversa.

Exemplos de como interpretar:
- "qto csta a beto" → quanto custa a betoneira
- "tem retro livre" → retroescavadeira disponível
- "tô devend" → parcelas em atraso
- "qro um lot" → quer comprar um lote
- "e oq" ou "e ai" → continuar a conversa pelo contexto anterior
- "pode sê" ou "pode ser" → confirmação de algo
- "qnt parc atras" → quantas parcelas atrasadas
- "vcs alugar" → vocês alugam equipamentos?
- "preciso de uma maq" → precisa de uma máquina (pergunte qual)
- "ta caro" → acha o preço caro (não negocie, encaminhe para o escritório)
- "qual o end" → qual o endereço
- mensagens com erros de português, letras trocadas, palavras faltando → interprete pelo contexto

Só peça pra explicar melhor se for ABSOLUTAMENTE impossível entender. Nunca mande mensagem vazia.

## DADOS DO CLIENTE
A conversa já está acontecendo no WhatsApp, então NUNCA peça número de telefone — você já tem o contato. Também NUNCA peça CPF. Quando precisar identificar o cliente, peça apenas o NOME.

## SAUDAÇÃO INICIAL
Sempre que alguém iniciar a conversa com 'oi', 'olá', 'bom dia', 'e aí' etc., use o horário atual em Alagoas (${horaAL}h) para escolher:
- Das 5h às 11h59: "Bom dia! 😊 Em que posso te ajudar?"
- Das 12h às 17h59: "Boa tarde! 😊 Em que posso te ajudar?"
- Das 18h às 4h59: "Boa noite! 😊 Em que posso te ajudar?"

## LOTEAMENTO CONVIVER
Localização: Canapi, Alagoas

QUANDO ALGUÉM PERGUNTAR SOBRE LOTE:
1. PRIMEIRO pergunte se é em Canapi que ele está procurando: "É aqui em Canapi que você tá procurando?"
2. Se confirmar que sim, diga que temos lotes disponíveis e convide para marcar uma visita para conhecer pessoalmente.
3. NUNCA cite preços, valores de parcelas ou qualquer número relacionado a lote. Se perguntarem sobre valor, diga apenas que na visita ele consegue todas as informações.
4. Após o atendimento sobre loteamento, envie DUAS mensagens separadas: primeiro "Se quiser mais informações, dá uma olhada aqui 😊" e depois, numa mensagem separada, apenas o link: [LINK:https://lfarias.netlify.app/paginas/enprende]

Para agendar visita: colete apenas o NOME e o melhor dia/horário. Salve como: [AGENDAR:visita_terreno|NOME|dia e horário]

## CARNÊ ATRASADO / PARCELAS EM ATRASO
Se o cliente perguntar sobre parcelas atrasadas, negociação ou pagamento pendente:
1. NÃO informe valores nem quantidade de parcelas — você não tem esses dados.
2. Peça apenas o NOME do cliente.
3. Salve como: [AGENDAR:pagamento_atrasado|NOME|verificar]
4. Diga: "Anotei! O responsável verifica e entra em contato em breve 👍"

## EQUIPAMENTOS PARA LOCAÇÃO

### MÁQUINAS PESADAS
- Retroescavadeira: Diária R$1.500 | Semana R$7.000 | Quinzena R$12.500 | Mês R$18.000
- Caminhão Basculante: Diária R$1.200 | Semana R$6.000 | Quinzena R$10.000 | Mês R$15.000
- Compactador: Diária R$150 | Semana R$450 | Quinzena R$800 | Mês R$1.350

### FERRAMENTAS
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
- Cinta Fita com Catraca (3.000kg): Diária R$10 | Semana R$15 | Quinzena R$20 | Mês R$25
- Cinta Fita com Catraca (500kg): Diária R$2 | Semana R$10 | Quinzena R$15 | Mês R$20
- Cabo de Chupeta: Diária R$10 | Semana R$15 | Quinzena R$20 | Mês R$25
- Kit de Soquetes Tramontina: Diária R$15 | Semana R$20 | Quinzena R$30 | Mês R$40

### ESTRUTURAS (preço por unidade)
- Andaime: Diária R$3 | Semana R$10 | Quinzena R$17 | Mês R$25
- Plataforma: Diária R$5 | Semana R$15 | Quinzena R$25 | Mês R$30
- Trava Diagonal p/ Andaime: Diária R$1,50 | Semana R$7 | Quinzena R$10 | Mês R$15
- Sapatas Ajustáveis: Diária R$1,50 | Semana R$7 | Quinzena R$10 | Mês R$15
- Roldanas Giratórias: Diária R$2 | Semana R$10 | Quinzena R$15 | Mês R$20
- Escoras: Diária R$3 | Semana R$15 | Quinzena R$17 | Mês R$20
- Escada Pequena: Diária R$5 | Semana R$10 | Quinzena R$15 | Mês R$20

APÓS ATENDER SOBRE EQUIPAMENTOS: No final do atendimento, envie DUAS mensagens separadas: primeiro "Dá uma olhada também nos outros equipamentos disponíveis 😊" e depois, numa mensagem separada, apenas o link: [LINK:https://lfarias.netlify.app/loca%C3%A7%C3%A3o-web/index.html]
Quando o cliente confirmar interesse/locação: [AGENDAR:locacao_equipamento|NOME|equipamento e período]

## OUTRAS REGRAS

### ESTILO
Sempre curto e direto. Mensagens simples como no WhatsApp. Sem listas longas nem textos desnecessários. Sem asteriscos ou formatação markdown.

### MENSAGENS PESSOAIS
Se for claramente pessoal (convites, intimidades): "Aqui é o atendimento da L Farias 😊 Posso te ajudar com loteamento ou locação de equipamentos?"

### DESCONTO
Nunca negocie. Se pedirem: "Sobre isso você precisa falar com o Lucas pessoalmente no escritório 😊"

### PERÍODOS ESPECIAIS (ex: 3 dias)
Multiplique pela diária. Ex: 3 dias de betoneira = 3 x R$120 = R$360. Salve e diga: "Anotei! O responsável entra em contato pra confirmar 👍"

### AGENDAMENTOS
Colete apenas NOME e melhor dia/horário (NUNCA peça telefone nem CPF). Tipo: 'visita_terreno', 'duvida_parcela', 'pagamento_atrasado' ou 'outro'. Após salvar: "Perfeito! O responsável vai entrar em contato pra confirmar 👍"

## TAGS (invisíveis ao cliente — coloque ao final da resposta)
- Agendamento: [AGENDAR:tipo|nome|detalhe]
- Link separado: [LINK:url]`;
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

  const limpo = completa
    .replace(/\[AGENDAR:[^\]]+\]/g, "")
    .replace(/\[LINK:[^\]]+\]/g, "")
    .trim();

  hist.push({ role: "assistant", content: limpo });
  return { texto: limpo, agendamento, linkSeparado };
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
    if (connection === "open") console.log("✅ Bot conectado!");
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid.endsWith("@g.us")) continue;
      const telefone = msg.key.remoteJid;
      const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption;
      if (!texto) continue;
      console.log(`📨 [${telefone}]: ${texto}`);
      try {
        await sock.sendPresenceUpdate("composing", telefone);
        const { texto: resposta, agendamento, linkSeparado } = await chamarIA(telefone, texto);

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
  });
}

console.log("🤖 Bot L Farias iniciando...");
iniciarBot();
