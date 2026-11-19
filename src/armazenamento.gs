/**
 * Propostas guardadas em uma planilha e referenciadas por um código curto.
 *
 * O link do cliente carrega só o código (?p=K7M2QX9HTB): os dados ficam no servidor, então
 * não há o que adulterar na URL. O código é a credencial de leitura e de aceite daquela
 * proposta, por isso é longo o bastante para não ser adivinhado e sai de fonte aleatória
 * criptográfica.
 */

const COLUNAS = [
  'Código', 'Criada em', 'Válida até', 'Tipo', 'Empresa', 'CNPJ', 'Representante',
  'Total (R$)', 'Status', 'Aceito por', 'CPF do aceite', 'Aceito em', 'Dados (JSON)',
];
const COL = {
  CODIGO: 0, CRIADA_EM: 1, VALIDA_ATE: 2, TIPO: 3, EMPRESA: 4, CNPJ: 5, REP: 6,
  TOTAL: 7, STATUS: 8, ACEITO_POR: 9, CPF: 10, ACEITO_EM: 11, DADOS: 12,
};

// Sem 0/O e 1/I, que se confundem quando alguém dita o código por telefone.
const ALFABETO_DO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_DO_CODIGO = 10;
const FORMATO_DO_CODIGO = /^[A-HJ-NP-Z2-9]{10}$/;

function fuso_() {
  return Session.getScriptTimeZone();
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM-dd');
}

function agora_() {
  return Utilities.formatDate(new Date(), fuso_(), 'dd/MM/yyyy HH:mm');
}

function comLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.ESPERA_LOCK_MS)) {
    throw new Error('O sistema está ocupado. Tente de novo em instantes.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function abaDePropostas_() {
  const id = propriedade_(CONFIG.PROP_PLANILHA);
  if (!id) throw new Error('Planilha de propostas não configurada (rode inicializar).');
  return SpreadsheetApp.openById(id).getSheetByName(CONFIG.ABA);
}

/**
 * Código aleatório de 50 bits. O alfabeto tem 32 símbolos, então cada byte do hash vira um
 * símbolo sem viés (256 é múltiplo de 32). Math.random não serve: é previsível.
 */
function novoCodigo_() {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid()
  );
  let codigo = '';
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) {
    codigo += ALFABETO_DO_CODIGO.charAt((bytes[i] & 0xff) % ALFABETO_DO_CODIGO.length);
  }
  return codigo;
}

/** { código: número da linha } de tudo o que está na planilha. */
function indiceDeCodigos_(aba) {
  const indice = {};
  const ultima = aba.getLastRow();
  if (ultima < 2) return indice;
  aba.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (linha, i) {
    indice[String(linha[0])] = i + 2;
  });
  return indice;
}

/** Grava a proposta e devolve o código. */
function salvarProposta_(limpos, visao) {
  return comLock_(function () {
    const aba = abaDePropostas_();
    const usados = indiceDeCodigos_(aba);
    let codigo = novoCodigo_();
    for (let tentativa = 0; usados[codigo]; tentativa++) {
      if (tentativa === 5) throw new Error('Não foi possível gerar um código único.');
      codigo = novoCodigo_();
    }
    aba.appendRow([
      codigo, agora_(), visao.validaAte, visao.ehHolding ? 'Holding' : 'Honorários',
      visao.empresa, visao.cnpj, visao.rep, visao.totalFmt, STATUS_ENVIADA, '', '', '',
      JSON.stringify(limpos),
    ]);
    return codigo;
  });
}

/**
 * Proposta pelo código, ou null. Não decide se ela está vencida: quem chama decide o que
 * mostrar (uma proposta vencida ainda pode ser lida, só não pode ser aceita).
 */
function carregarProposta_(codigo) {
  codigo = String(codigo || '').toUpperCase();
  if (!FORMATO_DO_CODIGO.test(codigo)) return null;
  const aba = abaDePropostas_();
  const linha = indiceDeCodigos_(aba)[codigo];
  if (!linha) return null;

  const celulas = aba.getRange(linha, 1, 1, COLUNAS.length).getValues()[0];
  let dados;
  try { dados = JSON.parse(celulas[COL.DADOS]); } catch (e) { return null; }
  const validaAte = celulaParaIso_(celulas[COL.VALIDA_ATE], fuso_());
  return {
    codigo: codigo,
    linha: linha,
    dados: dados,
    validaAte: validaAte,
    vencida: hojeIso_() > validaAte,
    aceita: celulas[COL.STATUS] === STATUS_ACEITA,
    aceitoPor: String(celulas[COL.ACEITO_POR] || ''),
    aceitoEm: String(celulas[COL.ACEITO_EM] || ''),
  };
}

/**
 * Marca a proposta como aceita. Relê a linha dentro do lock: dois cliques (ou duas abas)
 * não geram dois aceites. Devolve { novo, aceitoPor, aceitoEm }.
 */
function registrarAceite_(codigo, nome, cpf) {
  return comLock_(function () {
    const proposta = carregarProposta_(codigo);
    if (!proposta) throw new Error('Proposta não encontrada.');
    if (proposta.aceita) {
      return { novo: false, aceitoPor: proposta.aceitoPor, aceitoEm: proposta.aceitoEm };
    }
    if (proposta.vencida) throw new Error('Esta proposta venceu.');
    const quando = agora_();
    abaDePropostas_().getRange(proposta.linha, COL.STATUS + 1, 1, 4)
      .setValues([[STATUS_ACEITA, nome, formatarCpf_(cpf), quando]]);
    return { novo: true, aceitoPor: nome, aceitoEm: quando };
  });
}

/**
 * Apaga propostas vencidas há mais de RETENCAO_DIAS que não foram aceitas. As aceitas
 * ficam: são o registro do que foi combinado. Pensada para um gatilho de tempo diário.
 *
 * É pública (sem "_") para poder ser alvo de gatilho; chamada por um visitante, só
 * adianta a faxina que o gatilho faria.
 */
function limparPropostasExpiradas() {
  comLock_(function () {
    const aba = abaDePropostas_();
    const ultima = aba.getLastRow();
    if (ultima < 2) return;
    const corte = somarDias_(hojeIso_(), -CONFIG.RETENCAO_DIAS);
    const linhas = aba.getRange(2, 1, ultima - 1, COLUNAS.length).getValues();
    // De baixo para cima, para a exclusão não deslocar as linhas ainda não vistas.
    for (let i = linhas.length - 1; i >= 0; i--) {
      const vencidaHaTempo = celulaParaIso_(linhas[i][COL.VALIDA_ATE], fuso_()) < corte;
      if (vencidaHaTempo && linhas[i][COL.STATUS] !== STATUS_ACEITA) aba.deleteRow(i + 2);
    }
  });
}
