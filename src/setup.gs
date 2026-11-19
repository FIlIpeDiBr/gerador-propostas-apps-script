/**
 * Configuração inicial (rodar uma vez no editor) e e-mail de aceite.
 *
 * `inicializar` não tem "_" no fim para aparecer no menu Executar, o que também a deixa
 * chamável pelo navegador de qualquer visitante. Por isso ela NÃO devolve nada: a chave
 * da equipe vai só para o log de execução.
 */

function inicializar() {
  Logger.log(comLock_(configurar_));
}

/** Cria o que estiver faltando (planilha e chave da equipe). Pode rodar de novo. */
function configurar_() {
  const props = PropertiesService.getScriptProperties();

  let planilhaId = props.getProperty(CONFIG.PROP_PLANILHA);
  if (!planilhaId) {
    const ss = SpreadsheetApp.create('Propostas — registro');
    const aba = ss.getActiveSheet().setName(CONFIG.ABA);
    aba.appendRow(COLUNAS);
    aba.setFrozenRows(1);
    planilhaId = ss.getId();
    props.setProperty(CONFIG.PROP_PLANILHA, planilhaId);
  }

  let chave = props.getProperty(CONFIG.PROP_CHAVE_EQUIPE);
  if (!chave) {
    chave = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(CONFIG.PROP_CHAVE_EQUIPE, chave);
  }

  const base = urlDoApp_();
  return [
    'Configuração concluída.',
    'Planilha de propostas: https://docs.google.com/spreadsheets/d/' + planilhaId,
    'Chave da equipe: ' + chave,
    base ? 'Gerador: ' + base + '?k=' + chave : 'Publique como app da Web; o gerador é URL?k=' + chave,
    props.getProperty(CONFIG.PROP_EMAIL_ACEITE)
      ? 'E-mail de aceite: configurado.'
      : 'Falta o e-mail que recebe os aceites: crie a propriedade ' + CONFIG.PROP_EMAIL_ACEITE + '.',
  ].join('\n');
}

/** Avisa a equipe de que uma proposta foi aceita. O CPF vai mascarado; o completo fica na planilha. */
function enviarEmailDeAceite_(visao, nome, cpf, quando) {
  const destino = propriedade_(CONFIG.PROP_EMAIL_ACEITE);
  if (!destino) {
    Logger.log('Aceite sem e-mail: a propriedade ' + CONFIG.PROP_EMAIL_ACEITE + ' não está definida.');
    return;
  }
  MailApp.sendEmail({
    to: destino,
    subject: '[Propostas] Aceita — ' + visao.empresa,
    body: [
      'A proposta abaixo foi aceita pelo cliente.',
      '',
      'Empresa:        ' + visao.empresa,
      'CNPJ:           ' + visao.cnpj,
      'Representante:  ' + visao.rep,
      '',
      'Aceite por:     ' + nome,
      'CPF:            ' + mascararCpf_(cpf),
      'Data e hora:    ' + quando,
      '',
      'Proposta nº:    ' + visao.numero,
      'Emitida em:     ' + visao.dataEmissaoExt,
      'Plano/regime:   ' + visao.regimeLabel,
      'Atividade:      ' + visao.atividade,
      'Total mensal:   R$ ' + visao.totalFmt,
      '',
      'O aceite digital não substitui o contrato de prestação de serviços.',
    ].join('\n'),
  });
}
