/**
 * Gerador de Propostas — configuração.
 *
 * Um web app, três telas conforme a URL:
 *   ?k=<chave da equipe>  formulário que gera a proposta
 *   ?p=<código>           proposta para o cliente ler e aceitar
 *   (nada)                aviso de acesso restrito
 *
 * Tudo o que identifica o escritório está em MARCA. A tabela de preços e os planos abaixo
 * são FICTÍCIOS: servem para o cálculo ter o que calcular.
 * Valores em dinheiro são sempre inteiros, em centavos.
 */

const MARCA = {
  nome: 'Escritório Exemplo',
  assinatura: 'Contabilidade e assessoria',
  cidade: 'Cidade — UF',
  telefone: '(00) 0000-0000',
  email: 'contato@exemplo.com.br',
  destaques: [
    { titulo: 'Mensal', texto: 'fechamento com relatório gerencial' },
    { titulo: 'Digital', texto: 'documentos e aceite sem papel' },
    { titulo: 'Consultivo', texto: 'atendimento direto com quem conhece a empresa' },
  ],
};

const CONFIG = {
  // Largura de cada faixa de faturamento mensal.
  FAIXA_FATURAMENTO: 2000000,
  // Serviço opcional, só no Simples Nacional.
  VALOR_FATOR_R: 9000,
  VALIDADE_MAXIMA_DIAS: 365,
  // Proposta vencida e não aceita sai da planilha depois deste prazo.
  RETENCAO_DIAS: 90,
  ESPERA_LOCK_MS: 20000,

  ABA: 'Propostas',
  PROP_PLANILHA: 'PLANILHA_PROPOSTAS_ID',
  PROP_CHAVE_EQUIPE: 'CHAVE_EQUIPE',
  PROP_EMAIL_ACEITE: 'EMAIL_ACEITE',
  PROP_URL_APP: 'APP_URL',
};

/**
 * Honorários por regime e setor.
 *   base           mensalidade até a primeira faixa de faturamento
 *   incremento     acréscimo por faixa adicional
 *   pessoalValor   valor por funcionário ou sócio além do limite
 *   pessoalLimite  quantos funcionários e quantos sócios já estão inclusos
 * Lucro Real não entra: os valores são informados à mão no formulário.
 */
const TABELA_HONORARIOS = {
  'Simples Nacional': {
    'Serviços': { base: 40000, incremento: 5000, pessoalValor: 3500, pessoalLimite: 2 },
    'Comércio': { base: 60000, incremento: 5000, pessoalValor: 3500, pessoalLimite: 2 },
  },
  'Lucro Presumido': {
    'Serviços': { base: 70000, incremento: 6000, pessoalValor: 4000, pessoalLimite: 2 },
    'Comércio': { base: 80000, incremento: 6000, pessoalValor: 4000, pessoalLimite: 3 },
  },
};

/** Planos de holding: alternativa de preço fixo à proposta calculada. */
const PLANOS_HOLDING = [
  {
    id: 'essencial',
    nome: 'Essencial',
    preco: 25000,
    resumo: '1 CNPJ',
    itens: [
      '1 CNPJ',
      'Obrigações fiscais e acessórias',
      'Registro contábil das integralizações',
      'Controle da distribuição de lucros',
    ],
  },
  {
    id: 'grupo',
    nome: 'Grupo',
    preco: 55000,
    resumo: '2 ou 3 CNPJs',
    itens: [
      '2 ou 3 CNPJs',
      'Obrigações fiscais e acessórias',
      'Registro contábil das integralizações',
      'Controle da distribuição de lucros',
      'Demonstrações consolidadas',
    ],
  },
  {
    id: 'operacional',
    nome: 'Operacional',
    preco: 65000,
    resumo: '1 CNPJ com faturamento na primeira faixa',
    itens: [
      '1 CNPJ com operação',
      'Escrituração contábil e fiscal completa',
      'Apuração mensal de tributos',
      'Orientação para emissão de notas fiscais',
    ],
  },
];

const REGIME_SIMPLES = 'Simples Nacional';
const REGIME_PRESUMIDO = 'Lucro Presumido';
const REGIME_REAL = 'Lucro Real';

const STATUS_ENVIADA = 'Enviada';
const STATUS_ACEITA = 'Aceita';

function propriedade_(chave) {
  return PropertiesService.getScriptProperties().getProperty(chave);
}

function planoDeHolding_(id) {
  for (let i = 0; i < PLANOS_HOLDING.length; i++) {
    if (PLANOS_HOLDING[i].id === id) return PLANOS_HOLDING[i];
  }
  return null;
}
