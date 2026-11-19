/**
 * Formatação e validação: dinheiro em centavos, datas ISO, CPF e CNPJ.
 * Funções puras (não tocam em serviço nenhum do Google).
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 123456 → "1.234,56". Sem o "R$": quem exibe decide o prefixo. */
function moeda_(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const abs = Math.abs(n);
  const inteira = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracao = String(abs % 100).padStart(2, '0');
  return (n < 0 ? '-' : '') + inteira + ',' + fracao;
}

/** Valor em reais vindo do formulário (número) → centavos inteiros. NaN se não for número. */
function paraCentavos_(valor) {
  const n = Number(valor);
  return isFinite(n) ? Math.round(n * 100) : NaN;
}

/** "2026-05-29" é uma data que existe? */
function dataIsoValida_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 &&
         d.getUTCDate() === Number(m[3]);
}

/** Soma dias a uma data ISO, em calendário puro (sem fuso): "2026-01-30" + 3 → "2026-02-02". */
function somarDias_(iso, dias) {
  const p = iso.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(d.getUTCDate()).padStart(2, '0');
}

/** "2026-05-29" → "29 de maio de 2026". Valor fora do formato volta como veio. */
function dataPorExtenso_(iso) {
  if (!dataIsoValida_(iso)) return String(iso || '');
  const p = iso.split('-').map(Number);
  return p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0];
}

/**
 * Célula de data lida da planilha → "yyyy-MM-dd". O Sheets converte texto com cara de data
 * em Date por conta própria; comparar o valor cru com um texto falharia em silêncio.
 */
function celulaParaIso_(valor, fuso) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, fuso, 'yyyy-MM-dd');
  }
  return String(valor || '').slice(0, 10);
}

function soDigitos_(texto) {
  return String(texto || '').replace(/\D/g, '');
}

function cpfValido_(cpf) {
  const d = soDigitos_(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let fim = 9; fim <= 10; fim++) {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d.charAt(i)) * (fim + 1 - i);
    const digito = (soma * 10) % 11 % 10;
    if (digito !== Number(d.charAt(fim))) return false;
  }
  return true;
}

function formatarCpf_(cpf) {
  return soDigitos_(cpf).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/** "123.456.789-09" → "***.456.789-**": o bastante para conferir, sem expor o número. */
function mascararCpf_(cpf) {
  const d = soDigitos_(cpf);
  return d.length === 11 ? '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**' : '***';
}

/** Só os 14 caracteres do CNPJ, em maiúsculas. */
function normalizarCnpj_(cnpj) {
  return String(cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Valida o CNPJ, inclusive o alfanumérico (letras nas 12 primeiras posições, em vigor para
 * novas inscrições desde julho de 2026). A regra da Receita vale para os dois formatos:
 * cada caractere vale seu código ASCII menos 48, e os dígitos verificadores saem do
 * módulo 11 com pesos de 2 a 9.
 */
function cnpjValido_(cnpj) {
  const c = normalizarCnpj_(cnpj);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^0{14}$/.test(c)) return false;
  const digito = function (tamanho) {
    let soma = 0;
    let peso = 2;
    for (let i = tamanho - 1; i >= 0; i--) {
      soma += (c.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(c.charAt(12)) && digito(13) === Number(c.charAt(13));
}

function formatarCnpj_(cnpj) {
  return normalizarCnpj_(cnpj).replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
}

function escaparHtml_(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
