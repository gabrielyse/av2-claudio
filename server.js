const express = require('express');
const app = express();
app.use(express.json());

// "Banco" em memória
let ordens = [];

const CAMPOS = ['codigoOrdem', 'codigoProduto', 'tipoProduto',
  'quantidadeProduzida', 'custoUnitarioBase', 'estoqueInicial'];
const CAMPOS_NUMERICOS = ['quantidadeProduzida', 'custoUnitarioBase', 'estoqueInicial'];

// ---------- Funções auxiliares ----------
function existeCodigo(codigo) {
  return ordens.some(o => String(o.codigoOrdem) === String(codigo));
}

function buscarIndice(codigo) {
  return ordens.findIndex(o => String(o.codigoOrdem) === String(codigo));
}

function tipoValido(tipo) {
  const validos = [1, 2, 3];
  for (let i = 0; i < validos.length; i++) {
    switch (Number(tipo)) {
      case validos[i]:
        return true;
    }
  }
  return false;
}

// Valida os dados; retorna lista de erros (vazia = ok)
function validar(dados, parcial = false) {
  const erros = [];
  for (const campo of CAMPOS) {
    const presente = dados[campo] !== undefined && dados[campo] !== null && dados[campo] !== '';
    if (!presente) {
      if (!parcial) erros.push(`Campo obrigatório ausente: ${campo}`);
      continue;
    }
    if (CAMPOS_NUMERICOS.includes(campo)) {
      const n = Number(dados[campo]);
      if (typeof dados[campo] === 'boolean' || Number.isNaN(n) || n < 0) {
        erros.push(`${campo} deve ser um número maior ou igual a zero`);
      }
    }
  }
  if (dados.tipoProduto !== undefined && !tipoValido(dados.tipoProduto)) {
    erros.push('tipoProduto deve ser 1 (Padrão), 2 (Premium) ou 3 (Sob encomenda)');
  }
  return erros;
}

function calcularCustoAjustado(base, tipo) {
  switch (Number(tipo)) {
    case 1: return base;
    case 2: return base * 1.10;
    case 3: return base * 1.20;
    default: return base;
  }
}

function arredondar(v) {
  return Math.round(v * 100) / 100;
}

// Recalcula todos os campos derivados
function calcular(ordem) {
  ordem.estoqueFinal = ordem.estoqueInicial + ordem.quantidadeProduzida;
  ordem.custoUnitarioAjustado = arredondar(calcularCustoAjustado(ordem.custoUnitarioBase, ordem.tipoProduto));
  ordem.custoTotal = arredondar(ordem.quantidadeProduzida * ordem.custoUnitarioAjustado);
  if (ordem.estoqueFinal > 5000) ordem.alertaEstoque = 'ALTO';
  else if (ordem.estoqueFinal < 500) ordem.alertaEstoque = 'CRITICO';
  else ordem.alertaEstoque = 'NORMAL';
  return ordem;
}

function normalizar(dados) {
  const o = { ...dados };
  if (o.tipoProduto !== undefined) o.tipoProduto = Number(o.tipoProduto);
  CAMPOS_NUMERICOS.forEach(c => { if (o[c] !== undefined) o[c] = Number(o[c]); });
  if (o.codigoProduto !== undefined) o.codigoProduto = String(o.codigoProduto);
  return o;
}

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function gerarRelatorio() {
  const total = ordens.length;
  const rel = {
    totalOrdens: total,
    estoquePorTipo: { padrao: 0, premium: 0, sobEncomenda: 0 },
    mediaCustoTotalPorOrdem: 0,
    ordemMaisCara: null,
    ordemMaisBarata: null,
    quantidadeAlertas: { alto: 0, critico: 0, normal: 0 },
    porProduto: {}
  };
  if (total === 0) return rel;

  let somaCusto = 0;
  let cara = ordens[0];
  let barata = ordens[0];

  for (const o of ordens) {
    switch (o.tipoProduto) {
      case 1: rel.estoquePorTipo.padrao += o.estoqueFinal; break;
      case 2: rel.estoquePorTipo.premium += o.estoqueFinal; break;
      case 3: rel.estoquePorTipo.sobEncomenda += o.estoqueFinal; break;
    }
    somaCusto += o.custoTotal;
    if (o.custoTotal > cara.custoTotal) cara = o;
    if (o.custoTotal < barata.custoTotal) barata = o;

    if (o.alertaEstoque === 'ALTO') rel.quantidadeAlertas.alto++;
    else if (o.alertaEstoque === 'CRITICO') rel.quantidadeAlertas.critico++;
    else rel.quantidadeAlertas.normal++;

    if (!rel.porProduto[o.codigoProduto]) {
      rel.porProduto[o.codigoProduto] = { estoqueFinalConsolidado: 0, valorTotalInvestido: 0 };
    }
    rel.porProduto[o.codigoProduto].estoqueFinalConsolidado += o.estoqueFinal;
    rel.porProduto[o.codigoProduto].valorTotalInvestido =
      arredondar(rel.porProduto[o.codigoProduto].valorTotalInvestido + o.custoTotal);
  }

  rel.mediaCustoTotalPorOrdem = arredondar(somaCusto / total);
  rel.ordemMaisCara = { codigoOrdem: cara.codigoOrdem, custoTotal: cara.custoTotal };
  rel.ordemMaisBarata = { codigoOrdem: barata.codigoOrdem, custoTotal: barata.custoTotal };
  return rel;
}

// ---------- Rotas ----------
app.post('/ordens', (req, res) => {
  const dados = req.body || {};
  const erros = validar(dados);
  if (erros.length > 0) return res.status(400).json({ erros });
  if (existeCodigo(dados.codigoOrdem)) {
    return res.status(400).json({ erro: `Já existe uma ordem com codigoOrdem ${dados.codigoOrdem}` });
  }
  const ordem = calcular(normalizar({
    codigoOrdem: dados.codigoOrdem,
    codigoProduto: dados.codigoProduto,
    tipoProduto: dados.tipoProduto,
    quantidadeProduzida: dados.quantidadeProduzida,
    custoUnitarioBase: dados.custoUnitarioBase,
    estoqueInicial: dados.estoqueInicial
  }));
  ordens.push(ordem);
  res.status(201).json(ordem);
});

app.get('/ordens', (req, res) => {
  let resultado = ordens;
  if (req.query.tipo !== undefined) {
    resultado = resultado.filter(o => o.tipoProduto === Number(req.query.tipo));
  }
  if (req.query.alerta !== undefined) {
    const alvo = semAcento(req.query.alerta);
    resultado = resultado.filter(o => o.alertaEstoque === alvo);
  }
  res.json(resultado);
});

app.get('/ordens/:codigoOrdem', (req, res) => {
  const i = buscarIndice(req.params.codigoOrdem);
  if (i === -1) return res.status(404).json({ erro: 'Ordem não encontrada' });
  res.json(ordens[i]);
});

app.put('/ordens/:codigoOrdem', (req, res) => {
  const i = buscarIndice(req.params.codigoOrdem);
  if (i === -1) return res.status(404).json({ erro: 'Ordem não encontrada' });

  const dados = req.body || {};
  if (dados.codigoOrdem !== undefined && String(dados.codigoOrdem) !== String(ordens[i].codigoOrdem)) {
    return res.status(400).json({ erro: 'codigoOrdem não pode ser alterado' });
  }
  const erros = validar(dados, true);
  if (erros.length > 0) return res.status(400).json({ erros });

  const permitidos = ['codigoProduto', 'tipoProduto', 'quantidadeProduzida', 'custoUnitarioBase', 'estoqueInicial'];
  const alteracoes = {};
  permitidos.forEach(c => { if (dados[c] !== undefined) alteracoes[c] = dados[c]; });

  ordens[i] = calcular({ ...ordens[i], ...normalizar(alteracoes) });
  res.json(ordens[i]);
});

app.delete('/ordens/:codigoOrdem', (req, res) => {
  const i = buscarIndice(req.params.codigoOrdem);
  if (i === -1) return res.status(404).json({ erro: 'Ordem não encontrada' });
  ordens.splice(i, 1);
  res.json({ mensagem: 'Ordem removida com sucesso' });
});

app.get('/relatorios/ordens', (req, res) => {
  res.json(gerarRelatorio());
});

// JSON inválido no corpo
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  res.status(500).json({ erro: 'Erro interno' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API rodando em http://localhost:${PORT}`));
}
