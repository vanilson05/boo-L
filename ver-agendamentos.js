import { readFileSync } from "fs";

let db;
try {
  db = JSON.parse(readFileSync("agendamentos.json", "utf-8"));
} catch {
  console.log("Nenhum agendamento ainda.");
  process.exit(0);
}

const args = process.argv.slice(2);
const filtro = args[0];

let lista = db.agendamentos || [];
if (filtro) {
  lista = lista.filter(r => r.tipo === filtro);
  console.log(`\n📋 Agendamentos — tipo: "${filtro}"\n`);
} else {
  console.log("\n📋 Todos os agendamentos (mais recentes primeiro)\n");
  lista = [...lista].reverse();
}

if (lista.length === 0) {
  console.log("Nenhum registro encontrado.");
} else {
  for (const r of lista) {
    console.log(`#${r.id} | ${r.criado_em} | ${r.tipo}`);
    console.log(`   Nome:    ${r.nome}`);
    console.log(`   Detalhe: ${r.detalhe}`);
    console.log(`   Tel:     ${r.telefone}`);
    console.log(`   Status:  ${r.status}`);
    console.log("");
  }
}
console.log(`Total: ${lista.length} registro(s)`);
console.log("\nFiltros: visita_terreno | pagamento_atrasado | locacao_equipamento | outro");
