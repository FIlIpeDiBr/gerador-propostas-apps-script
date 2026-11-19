'use strict';
/**
 * As páginas de verdade, renderizadas com o que o servidor manda.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, plano, formulario, renderizar, compilarScripts, CPF } = require('./harness');

/** Gera uma proposta e devolve o HTML que o cliente recebe. */
function proposta(mudancas, depois = () => {}) {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  const { codigo } = plano(amb.gs.gerarLinkProposta(chave, formulario(mudancas)));
  depois(amb, codigo);
  const pagina = amb.abrir({ p: codigo });
  const html = renderizar('Proposta.html', { dados: pagina.dados, marca: pagina.marca, estadoJson: pagina.estadoJson });
  return { html, texto: html.replace(/<style>[^]*?<[/]style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}

test('proposta de honorários: mostra composição, tabela de faixas e total', () => {
  const { html, texto } = proposta({ totalFunc: 5, fatorR: true });
  assert.equal(compilarScripts(html), 1);
  assert.ok(!html.includes('<?') && !texto.includes('undefined') && !texto.includes('NaN'));
  assert.match(texto, /Honorário mensal total R\$ 695,00 \/ mês/);
  assert.match(texto, /Adicional de funcionários 3 de 5 funcionários acima do 2º × R\$ 35,00 R\$ 105,00/);
  assert.match(texto, /R\$ 40\.000,01 até R\$ 60\.000,00 faixa atual R\$ 500,00/);
  assert.match(texto, /A cada R\$ 20\.000,00 de faturamento adicional, acrescenta-se R\$ 50,00/);
  assert.match(texto, /vale até 9 de abril de 2026/);
  assert.match(texto, /Escritório Exemplo/);
});

test('proposta de holding: lista os itens do plano e não mostra tabela de faixas', () => {
  const { html, texto } = proposta({ tipo: 'holding', planoId: 'grupo' });
  assert.equal(compilarScripts(html), 1);
  assert.ok(!texto.includes('undefined'));
  assert.match(texto, /O plano Grupo contempla os seguintes serviços/);
  assert.match(texto, /Demonstrações consolidadas/);
  assert.match(texto, /R\$ 550,00 \/ mês/);
  assert.ok(!texto.includes('Tabela de honorários por faixa'));
});

test('proposta de Lucro Real: valores informados, sem tabela', () => {
  const { texto } = proposta({ regime: 'Lucro Real', mensalidadeBaseManual: 2500, taxaPessoalManual: 300 });
  assert.match(texto, /R\$ 2\.800,00 \/ mês/);
  assert.match(texto, /Taxa sobre faturamento — Lucro Real R\$ 2\.500,00/);
  assert.ok(!texto.includes('undefined') && !texto.includes('Tabela de honorários por faixa'));
});

test('texto digitado no formulário sai escapado na proposta', () => {
  const { html } = proposta({ empresa: 'Bar <b>&</b> Cia', observacoes: '<img src=x onerror=alert(1)>' });
  assert.ok(html.includes('Bar &lt;b&gt;&amp;&lt;/b&gt; Cia'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal(compilarScripts(html), 1);
});

test('o estado da proposta vai para a página: aceita e vencida', () => {
  const aceita = proposta({}, (amb, codigo) => amb.gs.aceitarProposta(codigo, 'Maria </script> Souza', CPF));
  assert.equal(compilarScripts(aceita.html), 1);
  assert.match(aceita.html, /"aceita":\{"por":"Maria \\u003c\/script\\u003e Souza"/);
  const vencida = proposta({}, (amb) => { amb.hoje = '2026-12-31'; });
  assert.match(vencida.html, /"vencida":true/);
});

test('gerador: renderiza com a tabela vinda do servidor e o script compila', () => {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  const pagina = amb.abrir({ k: chave });
  const html = renderizar('Gerador.html', { marca: pagina.marca, configJson: pagina.configJson });
  assert.equal(compilarScripts(html), 1);
  assert.ok(!html.includes('<?'));
  assert.match(html, /var CFG = \{"chave":"[0-9a-f]{32}","tabela":\{"Simples Nacional"/);
  // Não há número de preço escrito à mão na página: tudo vem de CFG.
  assert.ok(!/base:\s*\d/.test(html) && !/preco:\s*\d/.test(html));
});
