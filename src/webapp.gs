/**
 * Entrada do web app e as duas funções que as páginas chamam.
 *
 * No Apps Script, função global sem "_" no fim pode ser chamada pelo navegador de qualquer
 * visitante (google.script.run), inclusive de quem só recebeu um link de proposta. Por isso
 * só há duas aqui: `gerarLinkProposta`, que exige a chave da equipe, e `aceitarProposta`,
 * que exige o código da proposta.
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.p) return paginaDaProposta_(p.p);
  if (p.k && chaveConfere_(p.k)) return paginaDoGerador_(String(p.k));
  return paginaDeAviso_('Acesso restrito', 'Use o link da proposta que você recebeu.');
}

function chaveConfere_(chave) {
  return iguaisEmTempoConstante_(chave, propriedade_(CONFIG.PROP_CHAVE_EQUIPE));
}

/** Comparação em tempo constante, para não vazar a chave pelo tempo de resposta. */
function iguaisEmTempoConstante_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  }
  return diferenca === 0 && a.length > 0;
}

function urlDoApp_() {
  const salva = propriedade_(CONFIG.PROP_URL_APP);
  if (salva) return salva;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

/**
 * JSON para ser impresso dentro de <script>: JSON.stringify não escapa "</script>" nem os
 * separadores de linha, e uma razão social com isso encerraria o script da página.
 */
function jsonParaScript_(valor) {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, function (c) { return c === '\u2028' ? '\\u2028' : '\\u2029'; });
}

function paginaDoGerador_(chave) {
  const pagina = HtmlService.createTemplateFromFile('Gerador');
  pagina.marca = MARCA;
  // A tabela vai do servidor para o formulário: a prévia e a proposta usam os mesmos números.
  pagina.configJson = jsonParaScript_({
    chave: chave,
    tabela: TABELA_HONORARIOS,
    planos: PLANOS_HOLDING,
    faixa: CONFIG.FAIXA_FATURAMENTO,
    fatorR: CONFIG.VALOR_FATOR_R,
  });
  return pagina.evaluate()
    .setTitle('Gerar proposta — ' + MARCA.nome)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function paginaDaProposta_(codigo) {
  let proposta = null;
  try { proposta = carregarProposta_(codigo); } catch (e) { proposta = null; }
  if (!proposta) {
    return paginaDeAviso_('Proposta indisponível',
      'Este link não foi encontrado. Peça uma nova proposta pelo ' + MARCA.telefone + '.');
  }
  let visao;
  try {
    visao = calcularProposta_(proposta.dados);
  } catch (e) {
    return paginaDeAviso_('Proposta indisponível',
      'Não foi possível montar esta proposta. Fale com a gente pelo ' + MARCA.telefone + '.');
  }

  const pagina = HtmlService.createTemplateFromFile('Proposta');
  pagina.dados = visao;
  pagina.marca = MARCA;
  pagina.estadoJson = jsonParaScript_({
    codigo: proposta.codigo,
    vencida: proposta.vencida,
    aceita: proposta.aceita ? { por: proposta.aceitoPor, em: proposta.aceitoEm } : null,
  });
  return pagina.evaluate()
    .setTitle('Proposta de honorários — ' + MARCA.nome)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function paginaDeAviso_(titulo, mensagem) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto">' +
    '<h1 style="color:#c0392b">' + escaparHtml_(titulo) + '</h1>' +
    '<p>' + escaparHtml_(mensagem) + '</p></div>'
  ).setTitle(titulo);
}

/** Chamada pelo formulário da equipe. Valida, calcula, grava e devolve o link. */
function gerarLinkProposta(chave, formulario) {
  if (!chaveConfere_(chave)) throw new Error('Acesso negado.');
  const limpos = validarFormulario_(formulario);
  const visao = calcularProposta_(limpos);
  const codigo = salvarProposta_(limpos, visao);
  return {
    url: urlDoApp_() + '?p=' + codigo,
    codigo: codigo,
    validaAte: visao.validaAteExt,
    resumo: {
      empresa: visao.empresa,
      total: visao.totalFmt,
      linhas: visao.linhas,
      itens: visao.planoItens,
      ehHolding: visao.ehHolding,
      planoNome: visao.planoNome,
    },
  };
}

/**
 * Chamada pelo botão de aceite da proposta. Devolve sempre { ok, ... }: a página mostra ao
 * cliente o que de fato aconteceu, em vez de supor que deu certo.
 */
function aceitarProposta(codigo, nome, cpf) {
  nome = String(nome || '').trim().replace(/\s+/g, ' ');
  if (nome.length < 3 || nome.length > 120) return { ok: false, erro: 'Informe o nome completo.' };
  if (!cpfValido_(cpf)) return { ok: false, erro: 'CPF inválido.' };

  let proposta;
  try {
    proposta = carregarProposta_(codigo);
  } catch (e) {
    Logger.log('Aceite: falha ao ler a proposta: ' + e.message);
    return { ok: false, erro: 'Não foi possível registrar o aceite agora. Tente de novo em instantes.' };
  }
  if (!proposta) return { ok: false, erro: 'Proposta não encontrada.' };
  if (proposta.vencida && !proposta.aceita) {
    return { ok: false, erro: 'Esta proposta venceu. Peça uma nova pelo ' + MARCA.telefone + '.' };
  }

  let aceite;
  try {
    aceite = registrarAceite_(proposta.codigo, nome, cpf);
  } catch (e) {
    Logger.log('Aceite: falha ao gravar: ' + e.message);
    return { ok: false, erro: 'Não foi possível registrar o aceite agora. Tente de novo em instantes.' };
  }
  // O e-mail sai uma vez só, no primeiro aceite; se falhar, o aceite já está na planilha.
  if (aceite.novo) {
    try {
      enviarEmailDeAceite_(calcularProposta_(proposta.dados), nome, cpf, aceite.aceitoEm);
    } catch (e) {
      Logger.log('Aceite gravado, mas o e-mail falhou: ' + e.message);
    }
  }
  return { ok: true, por: aceite.aceitoPor, em: aceite.aceitoEm };
}
