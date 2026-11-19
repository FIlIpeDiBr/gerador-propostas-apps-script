'use strict';
/**
 * No Apps Script, toda função global sem "_" no fim pode ser chamada pelo navegador de
 * quem abre o web app (google.script.run.nome()), inclusive de quem só recebeu um link de
 * proposta. Estes testes tratam essa lista como a API pública e vigiam o que entra nela.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SRC, criarAmbiente, plano, formulario } = require('./harness');

const PUBLICAS = ['aceitarProposta', 'doGet', 'gerarLinkProposta', 'inicializar', 'limparPropostasExpiradas'];
const ler = (arquivo) => fs.readFileSync(path.join(SRC, arquivo), 'utf8');

test('a API pública é exatamente a lista esperada', () => {
  const { gs } = criarAmbiente();
  const publicas = Object.keys(gs).filter((n) => typeof gs[n] === 'function' && !n.endsWith('_')).sort();
  assert.deepEqual(publicas, PUBLICAS);
});

test('cada página chama só a função que lhe cabe', () => {
  const chamadas = (arquivo) => {
    const nomes = new Set();
    for (const trecho of ler(arquivo).split('google.script.run').slice(1)) {
      const alvo = [...trecho.matchAll(/\.\s*([A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]).find((n) => PUBLICAS.includes(n));
      assert.ok(alvo, arquivo + ': chamada sem função conhecida');
      nomes.add(alvo);
    }
    return [...nomes];
  };
  assert.deepEqual(chamadas('Gerador.html'), ['gerarLinkProposta']);
  assert.deepEqual(chamadas('Proposta.html'), ['aceitarProposta']);
});

test('nas páginas, só o JSON já escapado pelo servidor é impresso sem escape', () => {
  const semEscape = (arquivo) => [...ler(arquivo).matchAll(/<\?!=\s*([^?]+?)\s*\?>/g)].map((m) => m[1]);
  assert.deepEqual(semEscape('Gerador.html'), ['configJson']);
  assert.deepEqual(semEscape('Proposta.html'), ['estadoJson']);
});

test('inicializar não devolve nada a quem chama: a chave da equipe só vai para o log', () => {
  const amb = criarAmbiente();
  assert.equal(amb.gs.inicializar(), undefined);
  const chave = amb.props.CHAVE_EQUIPE;
  assert.match(chave, /^[0-9a-f]{32}$/);
  assert.ok(amb.logs.some((l) => l.includes(chave)));
  // Rodar de novo não troca a chave nem cria outra planilha.
  amb.gs.inicializar();
  assert.equal(amb.props.CHAVE_EQUIPE, chave);
  assert.equal(Object.keys(amb.planilhas).length, 1);
});

test('sem a chave da equipe, o gerador não abre e nenhuma proposta é criada', () => {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  for (const k of [undefined, '', 'errada', chave + 'x', chave.slice(1)]) {
    assert.equal(amb.abrir(k === undefined ? {} : { k }).tipo, 'aviso', String(k));
    assert.throws(() => amb.gs.gerarLinkProposta(k, formulario()), /Acesso negado/, String(k));
  }
  assert.equal(amb.linhas.length, 1, 'só o cabeçalho');

  const gerador = amb.abrir({ k: chave });
  assert.equal(gerador.arquivo, 'Gerador');
  const config = JSON.parse(gerador.configJson);
  assert.equal(config.chave, chave);
  assert.equal(config.tabela['Simples Nacional']['Serviços'].base, 40000);
  assert.equal(config.planos.length, 3);
});

test('quem tem o link de uma proposta não chega ao gerador tirando o código da URL', () => {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  const { codigo } = plano(amb.gs.gerarLinkProposta(chave, formulario()));
  const proposta = amb.abrir({ p: codigo });
  assert.equal(proposta.arquivo, 'Proposta');
  // Nada na página do cliente carrega a chave da equipe.
  assert.ok(!JSON.stringify([proposta.dados, proposta.estadoJson, proposta.marca]).includes(chave));
  assert.equal(amb.abrir({}).tipo, 'aviso');
  assert.match(amb.abrir({}).html, /Acesso restrito/);
});

test('sem chave configurada, chave vazia não passa', () => {
  const amb = criarAmbiente();
  amb.configurar();
  delete amb.props.CHAVE_EQUIPE;
  assert.throws(() => amb.gs.gerarLinkProposta('', formulario()), /Acesso negado/);
  assert.throws(() => amb.gs.gerarLinkProposta(undefined, formulario()), /Acesso negado/);
  assert.equal(amb.abrir({ k: '' }).tipo, 'aviso');
});

test('formulário inválido não grava nada, mesmo com a chave certa', () => {
  const amb = criarAmbiente();
  const chave = amb.configurar();
  assert.throws(() => amb.gs.gerarLinkProposta(chave, formulario({ cnpj: '123' })), /Revise: CNPJ/);
  assert.throws(() => amb.gs.gerarLinkProposta(chave, null), /Revise/);
  assert.equal(amb.linhas.length, 1);
});
