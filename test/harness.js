'use strict';
/**
 * Carrega os arquivos .gs de src/ em um contexto isolado do Node, do mesmo jeito que o
 * Apps Script faz: todos os arquivos compartilham o escopo global. Os serviços do Google
 * (planilha, propriedades, lock, e-mail, HTML) são dublês em memória, e o relógio é do teste.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..', 'src');

function avaliar(contexto, expressao) {
  return vm.runInContext(expressao, contexto);
}

/** Objetos criados dentro do contexto têm outro Object.prototype; isto os traz para o do teste. */
function plano(valor) {
  return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
}

class Aba {
  constructor(nome) { this.nome = nome; this.linhas = []; }
  setName(nome) { this.nome = nome; return this; }
  appendRow(linha) { this.linhas.push(linha.slice()); }
  deleteRow(n) { this.linhas.splice(n - 1, 1); }
  getLastRow() { return this.linhas.length; }
  setFrozenRows() {}
  getRange(linha, coluna, nLinhas = 1, nColunas = 1) {
    const aba = this;
    return {
      getValues() {
        const saida = [];
        for (let i = 0; i < nLinhas; i++) {
          const origem = aba.linhas[linha - 1 + i] || [];
          saida.push(Array.from({ length: nColunas }, (_, j) => (origem[coluna - 1 + j] === undefined ? '' : origem[coluna - 1 + j])));
        }
        return saida;
      },
      setValues(valores) {
        for (let i = 0; i < nLinhas; i++) {
          for (let j = 0; j < nColunas; j++) aba.linhas[linha - 1 + i][coluna - 1 + j] = valores[i][j];
        }
      },
    };
  }
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

/**
 * Monta o projeto com os dublês. `hoje` ("2026-03-10") é o dia que o servidor enxerga;
 * o teste pode mudá-lo com `amb.hoje = ...` para fazer o tempo passar.
 */
function criarAmbiente({ propriedades = {}, hoje = '2026-03-10' } = {}) {
  const props = { ...propriedades };
  const planilhas = {};
  const logs = [];
  const emails = [];
  const paginas = [];
  const lock = { livre: true, pegos: 0, soltos: 0 };
  const amb = { hoje, emailFalha: false };

  const servicos = {
    console,
    Logger: { log: (m) => logs.push(String(m)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    SpreadsheetApp: {
      create(nome) {
        const id = 'planilha' + (Object.keys(planilhas).length + 1);
        const aba = new Aba('Página1');
        planilhas[id] = { nome, aba, getId: () => id, getActiveSheet: () => aba, getSheetByName: (n) => (aba.nome === n ? aba : null) };
        return planilhas[id];
      },
      openById(id) {
        if (!planilhas[id]) throw new Error('planilha inexistente: ' + id);
        return planilhas[id];
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lock.livre) lock.pegos++; return lock.livre; },
        releaseLock: () => { lock.soltos++; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => crypto.randomUUID(),
      // Como no Apps Script: bytes com sinal (-128 a 127).
      computeDigest: (algoritmo, texto) => Array.from(new Int8Array(crypto.createHash(algoritmo).update(texto).digest())),
      formatDate(data, _fuso, formato) {
        // "Agora" é o dia do teste; uma data vinda de célula é formatada como ela é.
        const ehAgora = Math.abs(data.getTime() - Date.now()) < 5000;
        const iso = ehAgora ? amb.hoje : data.toISOString().slice(0, 10);
        if (formato === 'yyyy-MM-dd') return iso;
        const [a, m, d] = iso.split('-');
        return `${d}/${m}/${a} 14:${doisDigitos(emails.length + logs.length % 50)}`;
      },
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTE/exec' }) },
    MailApp: {
      sendEmail(mensagem) {
        if (amb.emailFalha) throw new Error('cota de e-mail esgotada');
        emails.push(mensagem);
      },
    },
    HtmlService: {
      createTemplateFromFile(arquivo) {
        const pagina = { tipo: 'modelo', arquivo };
        pagina.evaluate = () => {
          const saida = { setTitle: (t) => { pagina.titulo = t; return saida; }, addMetaTag: () => saida };
          paginas.push(pagina);
          return saida;
        };
        return pagina;
      },
      createHtmlOutput(html) {
        const pagina = { tipo: 'aviso', html };
        const saida = { setTitle: (t) => { pagina.titulo = t; return saida; } };
        paginas.push(pagina);
        return saida;
      },
    },
  };

  const gs = vm.createContext(servicos);
  for (const arquivo of fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, arquivo), 'utf8'), gs, { filename: arquivo });
  }

  Object.assign(amb, {
    gs, props, planilhas, logs, emails, paginas, lock,
    /** Roda a configuração inicial e devolve a chave da equipe gerada. */
    configurar() {
      gs.inicializar();
      props.EMAIL_ACEITE = 'equipe@exemplo.com.br';
      return props.CHAVE_EQUIPE;
    },
    /** Abre uma URL do web app e devolve a página que o servidor montou. */
    abrir(parametros) {
      gs.doGet({ parameter: parametros });
      return paginas[paginas.length - 1];
    },
  });
  // Getter: a planilha só existe depois de inicializar().
  Object.defineProperty(amb, 'linhas', { get: () => Object.values(planilhas)[0].aba.linhas });
  return amb;
}

const CNPJ = '11.222.333/0001-81';
const CNPJ_ALFANUMERICO = '12.ABC.345/01DE-35';
const CPF = '529.982.247-25';

/** Formulário válido de honorários no Simples Nacional; `mudancas` sobrepõe campos. */
function formulario(mudancas = {}) {
  return {
    tipo: 'honorarios', numero: '2026-0310-01', dataEmissao: '2026-03-10', validade: 30,
    rep: 'Maria Souza', empresa: 'Comércio Exemplo Ltda', cnpj: CNPJ, atividade: 'Comércio varejista',
    observacoes: '', regime: 'Simples Nacional', setor: 'Serviços', faturamento: 50000,
    totalFunc: 0, totalSocios: 1, fatorR: false,
    ...mudancas,
  };
}

/**
 * Renderiza um template .html do projeto como o HtmlService faria: `<? código ?>` executa,
 * `<?= x ?>` imprime com escape de HTML e `<?!= x ?>` imprime como está. Serve para os
 * testes pegarem variável inexistente, laço mal fechado e erro de sintaxe na página.
 */
function renderizar(arquivo, variaveis) {
  const fonte = fs.readFileSync(path.join(SRC, arquivo), 'utf8');
  const escapar = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let js = 'const __saida = [];\n';
  let pos = 0;
  for (const m of fonte.matchAll(/<[?](!=|=)?([^]*?)[?]>/g)) {
    js += '__saida.push(' + JSON.stringify(fonte.slice(pos, m.index)) + ');\n';
    if (m[1] === '=') js += '__saida.push(__escapar(' + m[2] + '));\n';
    else if (m[1] === '!=') js += '__saida.push(String(' + m[2] + '));\n';
    else js += m[2] + '\n';
    pos = m.index + m[0].length;
  }
  js += '__saida.push(' + JSON.stringify(fonte.slice(pos)) + ');\nreturn __saida.join("");';
  return new Function('__escapar', ...Object.keys(variaveis), js)(escapar, ...Object.values(variaveis));
}

/** Compila os <script> da página já renderizada; lança SyntaxError se algum estiver quebrado. */
function compilarScripts(html) {
  const blocos = [...html.matchAll(/<script>([^]*?)<[/]script>/g)].map((m) => m[1]);
  blocos.forEach((codigo) => new vm.Script(codigo));
  return blocos.length;
}

module.exports = {
  SRC, avaliar, plano, criarAmbiente, formulario, renderizar, compilarScripts,
  CNPJ, CNPJ_ALFANUMERICO, CPF,
};
