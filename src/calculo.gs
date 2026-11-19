/**
 * Cálculo da proposta: do registro validado ao que a página mostra.
 *
 * Função pura e em centavos inteiros: a soma de parcelas em ponto flutuante erra no
 * último centavo, e um centavo de diferença entre a proposta e o e-mail de aceite é o
 * tipo de erro que vira discussão com cliente.
 */

/** Índice (base 0) da faixa de faturamento: até uma faixa cheia é a 0; um centavo a mais, a 1. */
function indiceDaFaixa_(faturamento) {
  return Math.max(0, Math.ceil((faturamento || 0) / CONFIG.FAIXA_FATURAMENTO) - 1);
}

function linhaDePessoal_(plural, total, regra) {
  const excedente = Math.max(0, total - regra.pessoalLimite);
  const valor = excedente * regra.pessoalValor;
  let detalhe;
  if (excedente > 0) {
    detalhe = excedente + ' de ' + total + ' ' + plural + ' acima do ' + regra.pessoalLimite +
              'º × R$ ' + moeda_(regra.pessoalValor);
  } else if (total === 0) {
    detalhe = 'Sem ' + plural + ' registrados';
  } else {
    detalhe = total + ' ' + (total > 1 ? plural : plural.slice(0, -1)) + ' — incluso na mensalidade';
  }
  return {
    centavos: valor,
    linha: { nome: 'Adicional de ' + plural, detalhe: detalhe, valor: 'R$ ' + moeda_(valor), muted: excedente === 0 },
  };
}

function tributosDoRegime_(regime, setor) {
  if (regime === REGIME_SIMPLES) return 'DAS — Simples Nacional';
  if (setor === 'Comércio') return 'IRPJ, CSLL, PIS, COFINS e ICMS';
  return regime === REGIME_REAL ? 'IRPJ, CSLL, PIS, COFINS e demais tributos aplicáveis'
                                : 'IRPJ, CSLL, PIS, COFINS e ISS';
}

/** @param {Object} d registro devolvido por validarFormulario_ (ou relido da planilha) */
function calcularProposta_(d) {
  const visao = {
    tipo: d.tipo,
    ehHolding: d.tipo === 'holding',
    numero: d.numero,
    dataEmissaoExt: dataPorExtenso_(d.dataEmissao),
    validade: d.validade,
    validaAte: somarDias_(d.dataEmissao, d.validade),
    rep: d.rep,
    empresa: d.empresa,
    cnpj: d.cnpj,
    atividade: d.atividade,
    observacoes: d.observacoes || '',
    regime: '',
    setor: '',
    tributos: '',
    planoNome: '',
    planoItens: [],
    temFaturamento: false,
    faturamentoFmt: '',
    faixas: [],
    faixaFmt: moeda_(CONFIG.FAIXA_FATURAMENTO),
    incrementoFmt: '',
    linhas: [],
  };
  visao.validaAteExt = dataPorExtenso_(visao.validaAte);
  let total = 0;

  if (visao.ehHolding) {
    const plano = planoDeHolding_(d.planoId);
    if (!plano) throw new Error('Plano de holding desconhecido.');
    total = plano.preco;
    visao.regimeLabel = 'Plano Holding · ' + plano.nome;
    visao.planoNome = plano.nome;
    visao.planoItens = plano.itens;
  } else if (d.regime === REGIME_REAL) {
    total = d.mensalidadeManual + d.pessoalManual;
    visao.regime = d.regime;
    visao.regimeLabel = d.regime;
    visao.tributos = tributosDoRegime_(d.regime, '');
    visao.linhas.push({
      nome: 'Mensalidade base', detalhe: 'Taxa sobre faturamento — Lucro Real',
      valor: 'R$ ' + moeda_(d.mensalidadeManual), muted: false,
    });
    visao.linhas.push({
      nome: 'Taxa sobre pessoal',
      detalhe: d.pessoalManual > 0 ? 'Quadro societário e funcionários' : 'Sem taxa de pessoal',
      valor: 'R$ ' + moeda_(d.pessoalManual), muted: d.pessoalManual === 0,
    });
  } else {
    const regra = (TABELA_HONORARIOS[d.regime] || {})[d.setor];
    if (!regra) throw new Error('Combinação de regime e setor desconhecida.');
    const faixa = indiceDaFaixa_(d.faturamento);
    const base = regra.base + faixa * regra.incremento;
    const funcionarios = linhaDePessoal_('funcionários', d.totalFunc, regra);
    const socios = linhaDePessoal_('sócios', d.totalSocios, regra);
    total = base + funcionarios.centavos + socios.centavos;

    visao.regime = d.regime;
    visao.setor = d.setor;
    visao.regimeLabel = d.regime + ' · ' + d.setor;
    visao.tributos = tributosDoRegime_(d.regime, d.setor);
    visao.temFaturamento = true;
    visao.faturamentoFmt = moeda_(d.faturamento);
    visao.incrementoFmt = moeda_(regra.incremento);
    visao.linhas.push({
      nome: 'Mensalidade base', detalhe: 'Faixa de faturamento — ' + visao.regimeLabel,
      valor: 'R$ ' + moeda_(base), muted: false,
    });
    visao.linhas.push(funcionarios.linha, socios.linha);

    if (d.regime === REGIME_SIMPLES) {
      if (d.fatorR) total += CONFIG.VALOR_FATOR_R;
      visao.linhas.push({
        nome: 'Controle Fator R',
        detalhe: d.fatorR ? 'Acompanhamento do enquadramento Anexo III/V' : 'Serviço opcional — não contratado',
        valor: d.fatorR ? 'R$ ' + moeda_(CONFIG.VALOR_FATOR_R) : '—',
        muted: !d.fatorR,
      });
    }

    // Mostra ao menos 12 faixas; vai além se a empresa estiver mais acima (até 25).
    const quantas = Math.min(25, Math.max(12, faixa + 1));
    for (let i = 0; i < quantas; i++) {
      visao.faixas.push({
        de: 'R$ ' + moeda_(i === 0 ? 0 : i * CONFIG.FAIXA_FATURAMENTO + 1),
        ate: 'R$ ' + moeda_((i + 1) * CONFIG.FAIXA_FATURAMENTO),
        valor: 'R$ ' + moeda_(regra.base + i * regra.incremento),
        atual: i === faixa,
      });
    }
  }

  visao.temTabelaFaixas = visao.faixas.length > 0;
  visao.total = total;
  visao.totalFmt = moeda_(total);
  return visao;
}
