/**
 * Validação do formulário do gerador.
 *
 * O navegador também valida, mas só para dar retorno rápido: quem decide é o servidor.
 * Daqui sai o registro que é gravado na planilha e usado no cálculo, só com os campos do
 * tipo de proposta escolhido, com dinheiro já em centavos.
 */
function validarFormulario_(f) {
  f = f || {};
  const erros = [];
  const texto = function (campo, rotulo, minimo, maximo) {
    const v = String(f[campo] == null ? '' : f[campo]).trim();
    if (v.length < minimo || v.length > maximo) erros.push(rotulo);
    return v;
  };
  const inteiro = function (campo, rotulo, minimo, maximo) {
    const n = Number(f[campo]);
    if (!isFinite(n) || Math.floor(n) !== n || n < minimo || n > maximo) {
      erros.push(rotulo);
      return minimo;
    }
    return n;
  };
  const dinheiro = function (campo, rotulo, minimo, maximo) {
    const c = paraCentavos_(f[campo]);
    if (!isFinite(c) || c < minimo || c > maximo) {
      erros.push(rotulo);
      return 0;
    }
    return c;
  };

  const limpos = {
    tipo: f.tipo === 'holding' ? 'holding' : 'honorarios',
    numero: texto('numero', 'número da proposta', 1, 30),
    dataEmissao: String(f.dataEmissao || ''),
    validade: inteiro('validade', 'validade', 1, CONFIG.VALIDADE_MAXIMA_DIAS),
    rep: texto('rep', 'nome do representante', 3, 120),
    empresa: texto('empresa', 'razão social', 3, 160),
    cnpj: formatarCnpj_(f.cnpj),
    atividade: texto('atividade', 'atividade', 1, 160),
    observacoes: texto('observacoes', 'observações', 0, 2000),
  };
  if (!dataIsoValida_(limpos.dataEmissao)) erros.push('data de emissão');
  if (!cnpjValido_(f.cnpj)) erros.push('CNPJ');

  if (limpos.tipo === 'holding') {
    limpos.planoId = String(f.planoId || '');
    if (!planoDeHolding_(limpos.planoId)) erros.push('plano de holding');
  } else {
    limpos.regime = String(f.regime || '');
    if (limpos.regime === REGIME_REAL) {
      limpos.mensalidadeManual = dinheiro('mensalidadeBaseManual', 'taxa sobre faturamento', 1, 1e9);
      limpos.pessoalManual = dinheiro('taxaPessoalManual', 'taxa sobre pessoal', 0, 1e9);
    } else if (TABELA_HONORARIOS[limpos.regime]) {
      limpos.setor = String(f.setor || '');
      if (!TABELA_HONORARIOS[limpos.regime][limpos.setor]) erros.push('setor');
      limpos.faturamento = dinheiro('faturamento', 'faturamento mensal', 1, 1e12);
      limpos.totalFunc = inteiro('totalFunc', 'total de funcionários', 0, 5000);
      limpos.totalSocios = inteiro('totalSocios', 'total de sócios', 0, 500);
      limpos.fatorR = limpos.regime === REGIME_SIMPLES && f.fatorR === true;
    } else {
      erros.push('regime tributário');
    }
  }

  if (erros.length) throw new Error('Revise: ' + erros.join(', ') + '.');
  return limpos;
}
