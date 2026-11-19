'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, plano, formulario, CNPJ, CNPJ_ALFANUMERICO, CPF } = require('./harness');

const { gs } = criarAmbiente();
/** Valida e calcula, como o servidor faz ao gerar uma proposta. */
const calcular = (mudancas) => plano(gs.calcularProposta_(gs.validarFormulario_(formulario(mudancas))));
const emCentavos = (texto) => Number(texto.replace(/[^\d]/g, ''));

test('faixa de faturamento: o valor exato do limite fica na faixa de baixo; um centavo a mais sobe', () => {
  // Tabela fictícia: Simples/Serviços = base 400,00 + 50,00 por faixa de 20.000,00.
  assert.equal(calcular({ faturamento: 0.01 }).linhas[0].valor, 'R$ 400,00');
  assert.equal(calcular({ faturamento: 20000 }).linhas[0].valor, 'R$ 400,00');
  assert.equal(calcular({ faturamento: 20000.01 }).linhas[0].valor, 'R$ 450,00');
  assert.equal(calcular({ faturamento: 40000 }).linhas[0].valor, 'R$ 450,00');
  assert.equal(calcular({ faturamento: 220000 }).linhas[0].valor, 'R$ 900,00');
});

test('pessoal: cobra só o que passa do limite incluso, por funcionário e por sócio', () => {
  const p = calcular({ totalFunc: 5, totalSocios: 2 });
  assert.deepEqual(p.linhas.map((l) => [l.nome, l.valor, l.muted]), [
    ['Mensalidade base', 'R$ 500,00', false],            // faturamento 50.000 → terceira faixa
    ['Adicional de funcionários', 'R$ 105,00', false],   // 3 acima do 2º × 35,00
    ['Adicional de sócios', 'R$ 0,00', true],            // 2 sócios, inclusos
    ['Controle Fator R', '—', true],
  ]);
  assert.equal(p.linhas[1].detalhe, '3 de 5 funcionários acima do 2º × R$ 35,00');
  assert.equal(p.linhas[2].detalhe, '2 sócios — incluso na mensalidade');
  assert.equal(p.totalFmt, '605,00');
  assert.equal(calcular({ totalFunc: 1 }).linhas[1].detalhe, '1 funcionário — incluso na mensalidade');
  assert.equal(calcular({ totalFunc: 0 }).linhas[1].detalhe, 'Sem funcionários registrados');
});

test('Fator R só existe no Simples Nacional', () => {
  const comFatorR = calcular({ fatorR: true });
  assert.equal(comFatorR.total, 50000 + 9000);
  assert.deepEqual(comFatorR.linhas.at(-1), {
    nome: 'Controle Fator R', detalhe: 'Acompanhamento do enquadramento Anexo III/V', valor: 'R$ 90,00', muted: false,
  });
  const presumido = calcular({ regime: 'Lucro Presumido', setor: 'Comércio', fatorR: true, totalSocios: 4 });
  assert.ok(!presumido.linhas.some((l) => l.nome === 'Controle Fator R'));
  // Lucro Presumido/Comércio: base 800 + 2 faixas × 60 = 920; limite de 3 sócios, 1 excedente × 40.
  assert.equal(presumido.totalFmt, '960,00');
  assert.equal(presumido.tributos, 'IRPJ, CSLL, PIS, COFINS e ICMS');
});

test('o total é sempre a soma exata das linhas, em centavos', () => {
  for (const mudancas of [
    { faturamento: 1234567.89, totalFunc: 37, totalSocios: 9, fatorR: true },
    { regime: 'Lucro Presumido', setor: 'Serviços', faturamento: 333333.33, totalFunc: 3 },
    { regime: 'Lucro Real', mensalidadeBaseManual: 0.1, taxaPessoalManual: 0.2 },
    { regime: 'Lucro Real', mensalidadeBaseManual: 1234.56, taxaPessoalManual: 0.07 },
  ]) {
    const p = calcular(mudancas);
    const soma = p.linhas.filter((l) => l.valor !== '—').reduce((s, l) => s + emCentavos(l.valor), 0);
    assert.equal(p.total, soma, JSON.stringify(mudancas));
    assert.equal(emCentavos(p.totalFmt), p.total);
    assert.ok(Number.isInteger(p.total));
  }
  // 0,10 + 0,20 em ponto flutuante daria 0,30000000000000004.
  assert.equal(calcular({ regime: 'Lucro Real', mensalidadeBaseManual: 0.1, taxaPessoalManual: 0.2 }).totalFmt, '0,30');
});

test('Lucro Real usa os valores informados e não mostra tabela de faixas', () => {
  const p = calcular({ regime: 'Lucro Real', mensalidadeBaseManual: 2500, taxaPessoalManual: 0 });
  assert.equal(p.totalFmt, '2.500,00');
  assert.equal(p.temTabelaFaixas, false);
  assert.equal(p.temFaturamento, false);
  assert.deepEqual(p.linhas.map((l) => [l.nome, l.muted]), [['Mensalidade base', false], ['Taxa sobre pessoal', true]]);
});

test('plano de holding: preço fixo, itens do plano, sem composição', () => {
  const p = calcular({ tipo: 'holding', planoId: 'grupo' });
  assert.equal(p.ehHolding, true);
  assert.equal(p.totalFmt, '550,00');
  assert.equal(p.regimeLabel, 'Plano Holding · Grupo');
  assert.equal(p.planoItens.length, 5);
  assert.deepEqual(p.linhas, []);
});

test('tabela de faixas: mostra 12, destaca a atual e se estende até a faixa da empresa (teto de 25)', () => {
  const baixa = calcular({ faturamento: 50000 });
  assert.equal(baixa.faixas.length, 12);
  assert.deepEqual(baixa.faixas.map((f) => f.atual).indexOf(true), 2);
  assert.deepEqual(baixa.faixas[0], { de: 'R$ 0,00', ate: 'R$ 20.000,00', valor: 'R$ 400,00', atual: false });
  assert.deepEqual(baixa.faixas[1], { de: 'R$ 20.000,01', ate: 'R$ 40.000,00', valor: 'R$ 450,00', atual: false });
  const alta = calcular({ faturamento: 390000 });
  assert.equal(alta.faixas.length, 20);
  assert.equal(alta.faixas.at(-1).atual, true);
  assert.equal(calcular({ faturamento: 5000000 }).faixas.length, 25);
});

test('validade: a proposta vale até a data de emissão mais os dias, virando mês e ano', () => {
  assert.equal(calcular({ dataEmissao: '2026-03-10', validade: 30 }).validaAte, '2026-04-09');
  assert.equal(calcular({ dataEmissao: '2026-12-20', validade: 15 }).validaAteExt, '4 de janeiro de 2027');
  assert.equal(calcular({ dataEmissao: '2028-02-28', validade: 1 }).validaAte, '2028-02-29');
});

test('dinheiro: centavos inteiros viram texto no padrão brasileiro', () => {
  assert.deepEqual([0, 5, 99, 100, 123456, 100000000, -150].map((c) => gs.moeda_(c)),
    ['0,00', '0,05', '0,99', '1,00', '1.234,56', '1.000.000,00', '-1,50']);
  assert.equal(gs.paraCentavos_(19.99), 1999);
  assert.equal(gs.paraCentavos_(1.005), 100);   // o que o formulário manda já tem 2 casas
  assert.ok(Number.isNaN(gs.paraCentavos_('abc')));
});

test('formulário inválido: o servidor lista os campos e não calcula nada', () => {
  const erro = (mudancas) => { try { gs.validarFormulario_(formulario(mudancas)); return ''; } catch (e) { return e.message; } };
  assert.equal(erro({}), '');
  assert.match(erro({ rep: 'ab', empresa: '', cnpj: '11.222.333/0001-82', validade: 0 }),
    /validade.*nome do representante.*razão social.*CNPJ/);
  assert.match(erro({ dataEmissao: '2026-02-30' }), /data de emissão/);
  assert.match(erro({ dataEmissao: '10/03/2026' }), /data de emissão/);
  assert.match(erro({ regime: 'MEI' }), /regime tributário/);
  assert.match(erro({ setor: 'Indústria' }), /setor/);
  assert.match(erro({ faturamento: -1 }), /faturamento/);
  assert.match(erro({ faturamento: 'muito' }), /faturamento/);
  assert.match(erro({ totalFunc: 2.5 }), /funcionários/);
  assert.match(erro({ validade: 366 }), /validade/);
  assert.match(erro({ tipo: 'holding', planoId: 'inexistente' }), /plano de holding/);
  assert.match(erro({ regime: 'Lucro Real', mensalidadeBaseManual: 0 }), /taxa sobre faturamento/);
  assert.match(erro({ observacoes: 'x'.repeat(2001) }), /observações/);
});

test('o registro validado só leva os campos do tipo escolhido, com dinheiro em centavos', () => {
  const honorarios = plano(gs.validarFormulario_(formulario({ faturamento: 50000.5, planoId: 'grupo', mensalidadeBaseManual: 9 })));
  assert.equal(honorarios.faturamento, 5000050);
  assert.equal(honorarios.cnpj, CNPJ);
  assert.ok(!('planoId' in honorarios) && !('mensalidadeManual' in honorarios));
  const holding = plano(gs.validarFormulario_(formulario({ tipo: 'holding', planoId: 'essencial' })));
  assert.ok(!('regime' in holding) && !('faturamento' in holding));
  // fatorR precisa ser true de verdade; fora do Simples é sempre falso.
  assert.equal(plano(gs.validarFormulario_(formulario({ fatorR: 'sim' }))).fatorR, false);
  assert.equal(plano(gs.validarFormulario_(formulario({ regime: 'Lucro Presumido', fatorR: true }))).fatorR, false);
});

test('CNPJ: aceita o numérico e o alfanumérico, confere os dígitos verificadores', () => {
  assert.equal(gs.cnpjValido_(CNPJ), true);
  assert.equal(gs.cnpjValido_('11222333000181'), true);
  assert.equal(gs.cnpjValido_(CNPJ_ALFANUMERICO), true);       // exemplo divulgado pela Receita
  assert.equal(gs.cnpjValido_('12.abc.345/01de-35'), true);    // minúsculas são normalizadas
  assert.equal(gs.formatarCnpj_('12abc34501de35'), CNPJ_ALFANUMERICO);
  for (const ruim of ['11.222.333/0001-80', '12.ABC.345/01DE-36', '00.000.000/0000-00', '1122233300018', '12.ABC.345/01DE-3X', '', null]) {
    assert.equal(gs.cnpjValido_(ruim), false, String(ruim));
  }
});

test('CPF: confere os dígitos verificadores e recusa sequências repetidas', () => {
  assert.equal(gs.cpfValido_(CPF), true);
  assert.equal(gs.cpfValido_('52998224725'), true);
  for (const ruim of ['529.982.247-26', '111.111.111-11', '000.000.000-00', '5299822472', '', null]) {
    assert.equal(gs.cpfValido_(ruim), false, String(ruim));
  }
  assert.equal(gs.mascararCpf_(CPF), '***.982.247-**');
  assert.equal(gs.formatarCpf_('52998224725'), CPF);
});
