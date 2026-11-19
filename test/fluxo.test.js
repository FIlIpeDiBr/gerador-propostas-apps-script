'use strict';
/**
 * O caminho inteiro: a equipe gera a proposta, o cliente abre o link e aceita.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, plano, formulario, CPF } = require('./harness');

const COL = { CODIGO: 0, VALIDA_ATE: 2, STATUS: 8, ACEITO_POR: 9, CPF: 10, ACEITO_EM: 11, DADOS: 12 };

/** Ambiente configurado com uma proposta já gerada (válida até 09/04/2026). */
function preparar(mudancas = {}) {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  const gerada = plano(amb.gs.gerarLinkProposta(chave, formulario(mudancas)));
  return { amb, chave, gerada, gs: amb.gs, linha: () => amb.linhas[1] };
}

test('gerar: grava a linha, devolve o link curto e o resumo', () => {
  const { amb, gerada, linha } = preparar({ totalFunc: 5 });
  assert.match(gerada.codigo, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(gerada.url, 'https://script.google.com/macros/s/TESTE/exec?p=' + gerada.codigo);
  assert.equal(gerada.validaAte, '9 de abril de 2026');
  assert.equal(gerada.resumo.total, '605,00');
  assert.equal(amb.linhas.length, 2);
  assert.deepEqual(plano(linha()).slice(0, 9), [
    gerada.codigo, linha()[1], '2026-04-09', 'Honorários', 'Comércio Exemplo Ltda', '11.222.333/0001-81',
    'Maria Souza', '605,00', 'Enviada',
  ]);
  // O que fica guardado é o registro validado, não o que o navegador mandou.
  assert.equal(JSON.parse(linha()[COL.DADOS]).faturamento, 5000000);
});

test('os códigos saem do alfabeto sem 0/O/1/I e não se repetem', () => {
  const { amb, chave, gs } = preparar();
  for (let i = 0; i < 60; i++) gs.gerarLinkProposta(chave, formulario({ numero: 'n' + i }));
  const codigos = amb.linhas.slice(1).map((l) => l[COL.CODIGO]);
  assert.equal(new Set(codigos).size, 61);
  assert.ok(codigos.every((c) => /^[A-HJ-NP-Z2-9]{10}$/.test(c)));
});

test('o cliente abre a proposta pelo código e vê os valores calculados no servidor', () => {
  const { amb, gerada } = preparar();
  const pagina = amb.abrir({ p: gerada.codigo });
  assert.equal(pagina.arquivo, 'Proposta');
  assert.equal(pagina.dados.totalFmt, '500,00');
  assert.equal(pagina.dados.empresa, 'Comércio Exemplo Ltda');
  assert.equal(pagina.marca.nome, 'Escritório Exemplo');
  assert.deepEqual(JSON.parse(pagina.estadoJson), { codigo: gerada.codigo, vencida: false, aceita: null });
  // O código dito em minúsculas (por telefone, digitado à mão) também abre.
  assert.equal(amb.abrir({ p: gerada.codigo.toLowerCase() }).arquivo, 'Proposta');
});

test('código inexistente ou malformado mostra aviso, sem dizer qual dos dois', () => {
  const { amb } = preparar();
  for (const p of ['AAAAAAAAAA', 'abc', '../../x', '0000000000', "<script>alert(1)</script>"]) {
    const pagina = amb.abrir({ p });
    assert.equal(pagina.tipo, 'aviso', p);
    assert.match(pagina.html, /Proposta indisponível/);
    assert.ok(!pagina.html.includes('<script>'));
  }
});

test('aceite: grava nome, CPF e hora, e avisa a equipe por e-mail com o CPF mascarado', () => {
  const { amb, gerada, gs, linha } = preparar();
  const r = plano(gs.aceitarProposta(gerada.codigo, '  Maria   de Souza ', CPF));
  assert.equal(r.ok, true);
  assert.equal(r.por, 'Maria de Souza');
  assert.deepEqual(plano(linha()).slice(COL.STATUS, COL.ACEITO_EM + 1), ['Aceita', 'Maria de Souza', CPF, r.em]);

  assert.equal(amb.emails.length, 1);
  const [email] = amb.emails;
  assert.equal(email.to, 'equipe@exemplo.com.br');
  assert.equal(email.subject, '[Propostas] Aceita — Comércio Exemplo Ltda');
  assert.match(email.body, /CPF:\s+\*\*\*\.982\.247-\*\*/);
  assert.ok(!email.body.includes('529'), 'o CPF completo não vai por e-mail');
  assert.match(email.body, /Total mensal:\s+R\$ 500,00/);

  // Ao reabrir o link, a página já nasce como aceita.
  assert.deepEqual(JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson).aceita, { por: 'Maria de Souza', em: r.em });
});

test('aceitar de novo não muda o registro nem manda outro e-mail', () => {
  const { amb, gerada, gs, linha } = preparar();
  const primeiro = plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF));
  const antes = JSON.stringify(linha());
  const segundo = plano(gs.aceitarProposta(gerada.codigo, 'Outra Pessoa', '111.444.777-35'));
  assert.deepEqual(segundo, primeiro);
  assert.equal(JSON.stringify(linha()), antes);
  assert.equal(amb.emails.length, 1);
});

test('aceite com dados inválidos devolve o motivo e não grava nada', () => {
  const { amb, gerada, gs, linha } = preparar();
  assert.deepEqual(plano(gs.aceitarProposta(gerada.codigo, 'Ma', CPF)), { ok: false, erro: 'Informe o nome completo.' });
  assert.deepEqual(plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', '529.982.247-26')), { ok: false, erro: 'CPF inválido.' });
  assert.deepEqual(plano(gs.aceitarProposta('AAAAAAAAAA', 'Maria de Souza', CPF)), { ok: false, erro: 'Proposta não encontrada.' });
  assert.deepEqual(plano(gs.aceitarProposta(undefined, 'Maria de Souza', CPF)), { ok: false, erro: 'Proposta não encontrada.' });
  assert.equal(linha()[COL.STATUS], 'Enviada');
  assert.equal(amb.emails.length, 0);
});

test('proposta vencida: abre para leitura, avisa que venceu e recusa o aceite', () => {
  const { amb, gerada, gs, linha } = preparar();   // vale até 2026-04-09
  amb.hoje = '2026-04-09';
  assert.equal(JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson).vencida, false, 'o último dia ainda vale');
  amb.hoje = '2026-04-10';
  assert.equal(JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson).vencida, true);
  const r = plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF));
  assert.equal(r.ok, false);
  assert.match(r.erro, /venceu/);
  assert.equal(linha()[COL.STATUS], 'Enviada');
  assert.equal(amb.emails.length, 0);
});

test('a validade continua valendo quando o Sheets converte a célula de data em Date', () => {
  const { amb, gerada, gs, linha } = preparar();
  // É o que a planilha faz sozinha com um texto "2026-04-09".
  linha()[COL.VALIDA_ATE] = new Date('2026-04-09T12:00:00Z');
  amb.hoje = '2026-04-09';
  assert.equal(JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson).vencida, false);
  amb.hoje = '2026-04-10';
  assert.equal(JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson).vencida, true);
  assert.equal(plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF)).ok, false);
});

test('proposta aceita no prazo continua aparecendo como aceita depois de vencer', () => {
  const { amb, gerada, gs } = preparar();
  gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF);
  amb.hoje = '2027-01-01';
  const estado = JSON.parse(amb.abrir({ p: gerada.codigo }).estadoJson);
  assert.equal(estado.aceita.por, 'Maria de Souza');
  assert.equal(plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF)).ok, true);
  assert.equal(amb.emails.length, 1);
});

test('se o e-mail falhar, o aceite continua gravado e o cliente vê que deu certo', () => {
  const { amb, gerada, gs, linha } = preparar();
  amb.emailFalha = true;
  assert.equal(plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF)).ok, true);
  assert.equal(linha()[COL.STATUS], 'Aceita');
  assert.ok(amb.logs.some((l) => l.includes('e-mail falhou')));
});

test('com a planilha ocupada, o aceite devolve erro em vez de fingir sucesso', () => {
  const { amb, gerada, gs, linha } = preparar();
  amb.lock.livre = false;
  const r = plano(gs.aceitarProposta(gerada.codigo, 'Maria de Souza', CPF));
  assert.equal(r.ok, false);
  assert.match(r.erro, /Tente de novo/);
  assert.equal(linha()[COL.STATUS], 'Enviada');
  assert.equal(amb.emails.length, 0);
});

test('faxina: apaga só o que venceu há mais de 90 dias e não foi aceito', () => {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  const gerar = (numero, dataEmissao) => plano(amb.gs.gerarLinkProposta(chave, formulario({ numero, dataEmissao, validade: 10 })));
  const antigaAceita = gerar('aceita', '2025-10-01');
  gerar('antiga', '2025-10-01');            // venceu em 11/10/2025
  gerar('recente', '2026-01-01');           // venceu em 11/01/2026, há menos de 90 dias
  gerar('vigente', '2026-03-05');
  amb.hoje = '2025-10-05';
  amb.gs.aceitarProposta(antigaAceita.codigo, 'Maria de Souza', CPF);
  amb.hoje = '2026-03-10';

  amb.gs.limparPropostasExpiradas();
  assert.deepEqual(amb.linhas.slice(1).map((l) => JSON.parse(l[COL.DADOS]).numero), ['aceita', 'recente', 'vigente']);
});

test('razão social com "</script>" não quebra a página nem o JSON impresso nela', () => {
  const { amb, gs } = preparar();
  const nome = 'Bar </script><script>alert(1)</script> & Cia';
  const chave = amb.props.CHAVE_EQUIPE;
  const { codigo } = plano(gs.gerarLinkProposta(chave, formulario({ empresa: nome })));
  gs.aceitarProposta(codigo, 'Fulano </script>', CPF);
  const pagina = amb.abrir({ p: codigo });
  assert.equal(pagina.dados.empresa, nome);   // o template escapa ao imprimir com <?= ?>
  assert.ok(!/[<>&]/.test(pagina.estadoJson));
  assert.equal(JSON.parse(pagina.estadoJson).aceita.por, 'Fulano </script>');
});
