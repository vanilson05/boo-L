# Bot WhatsApp — L Farias

Bot de atendimento automático no WhatsApp usando Claude (Anthropic) + Baileys.

## Instalação

### 1. Instalar dependências
Clique duas vezes no **INSTALAR.bat**

### 2. Configurar chave
Renomeie `.env.exemplo` para `.env` e coloque sua chave:
```
ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui
```

### 3. Rodar
```bash
node index.js
```
Escaneie o QR Code com o WhatsApp.

### 4. Rodar em segundo plano (VPS)
```bash
npm install -g pm2
pm2 start index.js --name bot-lfarias
pm2 save
pm2 startup
```

## Ver agendamentos
```bash
node ver-agendamentos.js                     # todos
node ver-agendamentos.js visita_terreno      # visitas ao lote
node ver-agendamentos.js pagamento_atrasado  # carnês
node ver-agendamentos.js locacao_equipamento # locações
```

## Chave API
Pegue sua chave em: https://console.anthropic.com
