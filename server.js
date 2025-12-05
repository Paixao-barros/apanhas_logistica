// server.js
require('dotenv').config(); // CARREGA VARIÁVEIS DO ARQUIVO .ENV

const express = require('express');
const path = require('path');
const oracledb = require('oracledb');
const http = require('http');
const { Server } = require('socket.io');

// ================== ORACLE CLIENT ==================
try {
  if (process.platform === 'win32') {
    oracledb.initOracleClient({
      libDir: process.env.ORA_LIBDIR_WIN
    });
    console.log('ORACLE CLIENT WINDOWS INICIALIZADO COM libDir =', process.env.ORA_LIBDIR_WIN);
  } else if (process.platform === 'linux') {
    oracledb.initOracleClient({
      libDir: process.env.ORA_LIBDIR_LINUX
    });
    console.log('ORACLE CLIENT LINUX INICIALIZADO COM libDir =', process.env.ORA_LIBDIR_LINUX);
  } else {
    console.log('PLATAFORMA NÃO RECONHECIDA, TENTANDO RODAR SEM initOracleClient (MODO THIN).');
  }
  console.log('CLIENTE ORACLE INICIALIZADO');
} catch (err) {
  console.error('ERRO AO INICIALIZAR O CLIENT ORACLE:');
  console.error(err);
  process.exit(1);
}

// ================== CONFIG BANCO ==================
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, // AGORA VEM DO .ENV
  connectString: `
    (DESCRIPTION =
      (ADDRESS = (PROTOCOL = TCP)(HOST = ${process.env.DB_HOST})(PORT = ${process.env.DB_PORT}))
      (CONNECT_DATA =
        (SERVER = DEDICATED)
        (SERVICE_NAME = ${process.env.DB_SERVICE})
      )
    )
  `
};

// ================== EXPRESS + HTTP + SOCKET.IO ==================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 3000;

// SERVIR ARQUIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname, 'public')));

// ROTA RAIZ -> INDEX.HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ROTA EXTRA /INDEX.HTML (OPCIONAL)
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================== FUNÇÃO HELPER DE DATA ==================
function getDataHojeDDMMYYYY() {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const yyyy = hoje.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ================== SQL PRINCIPAL ==================
const SQL_APANHAS = `
WITH horarios_transformados AS (
    SELECT
        ORDEM,
        HORA_INI,
        HORA_FIM,
        CASE
            WHEN HORA_INI = '23:00' THEN 23/24
            ELSE (TO_NUMBER(SUBSTR(HORA_INI, 1, 2)) * 60 + TO_NUMBER(SUBSTR(HORA_INI, 4, 2))) / (24*60)
        END AS FRACT_HORA_INI,
        CASE
            WHEN HORA_FIM = '00:00' THEN 1
            ELSE (TO_NUMBER(SUBSTR(HORA_FIM, 1, 2)) * 60 + TO_NUMBER(SUBSTR(HORA_FIM, 4, 2))) / (24*60)
        END AS FRACT_HORA_FIM
    FROM (
        SELECT
            CASE
                WHEN LEVEL BETWEEN 8 AND 24 THEN LEVEL - 7
                ELSE LEVEL + 17
            END AS ORDEM,
            TO_CHAR(TO_DATE('00:00','HH24:MI') + (LEVEL - 1)/24, 'HH24:MI') AS HORA_INI,
            TO_CHAR(TO_DATE('01:00','HH24:MI') + (LEVEL - 1)/24, 'HH24:MI') AS HORA_FIM
        FROM dual
        CONNECT BY LEVEL <= 24
    )
),

saldo_inicial_pendencias AS (
    SELECT
        COUNT(DISTINCT p.NUMOS || '-' || p.CODENDERECO) AS SALDO_INICIAL
    FROM PCMOVENDPEND p
    JOIN PCPRODUT pr ON pr.CODPROD = p.CODPROD
    WHERE p.CODFILIAL = '1'
        AND p.NUMOS > 0
        AND p.DTESTORNO IS NULL
        AND p.NUMCAR IS NOT NULL
        AND p.CODOPER = 'S'
        AND p.TIPOOS IN (10, 12, 13, 16, 17, 20, 22)
        AND (
            (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) >= TRUNC(TO_DATE(:DATAPEND, 'DD/MM/YYYY') - 8) + 7/24
            AND (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) < TRUNC(TO_DATE(:DATAPEND, 'DD/MM/YYYY')) + 7/24
        )
        AND (
            p.DTFIMSEPARACAO IS NULL OR
            p.DTFIMSEPARACAO >= TRUNC(TO_DATE(:DATAPEND, 'DD/MM/YYYY')) + 7/24
        )
        AND p.NUMBOX <> 10
),

detalhes_pendencias_antes_07 AS (
    SELECT
        (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) AS DATA_HORA_REAL,
        p.DTFIMSEPARACAO AS DATA_HORA_REFERENCIA,
        p.DTFIMCONFERENCIA AS DATA_HORA_REFERENCIA_CONF,
        'PENDENTE' AS ORIGEM,
        p.NUMCAR,
        p.CODFUNCOS,
        p.NUMOS,
        p.CODENDERECO,
        p.CODFUNCCONF,
        p.DTFIMSEPARACAO,
        p.QTSEPARADA,
        p.TIPOOS,
        p.QT,
        pr.QTUNITCX
    FROM PCMOVENDPEND p
    JOIN PCPRODUT pr ON pr.CODPROD = p.CODPROD
    WHERE p.CODFILIAL = '1'
        AND p.NUMOS > 0
        AND p.DTESTORNO IS NULL
        AND p.NUMCAR IS NOT NULL
        AND p.CODOPER = 'S'
        AND p.DTFIMSEPARACAO IS NOT NULL
        AND (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) < TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 7/24
        AND p.DTFIMSEPARACAO >= TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 7/24
        AND p.DTFIMSEPARACAO <= TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 1
        AND p.DATA BETWEEN TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) - 5 AND TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY'))
        AND p.TIPOOS IN (10, 12, 13, 16, 17, 20, 22)
        AND p.NUMBOX <> 10
),

cargas_montadas_hoje AS (
    SELECT
        (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) AS DATA_HORA_REAL,
        p.DTFIMSEPARACAO AS DATA_HORA_REFERENCIA,
        p.DTFIMCONFERENCIA AS DATA_HORA_REFERENCIA_CONF,
        'APANHA' AS ORIGEM,
        p.NUMCAR,
        p.CODFUNCOS,
        p.NUMOS,
        p.CODENDERECO,
        p.CODFUNCCONF,
        p.DTFIMSEPARACAO,
        p.QTSEPARADA,
        p.TIPOOS,
        p.QT,
        pr.QTUNITCX
    FROM PCMOVENDPEND p
    JOIN PCPRODUT pr ON pr.CODPROD = p.CODPROD
    WHERE p.CODFILIAL = '1'
        AND p.NUMOS > 0
        AND p.DTESTORNO IS NULL
        AND p.NUMCAR IS NOT NULL
        AND p.CODOPER = 'S'
        AND p.DATA BETWEEN TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY'))
                             AND TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 1
        AND (p.DATA + (p.HORA/24) + (p.MINUTO/1440)) BETWEEN TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 7/24
                                                        AND TRUNC(TO_DATE(:DATATURNO, 'DD/MM/YYYY')) + 1
        AND p.TIPOOS IN (10, 12, 13, 16, 17, 20, 22)
        AND p.NUMBOX <> 10
),

base_dados AS (
    SELECT * FROM cargas_montadas_hoje
    UNION ALL
    SELECT * FROM detalhes_pendencias_antes_07
),

conferentes_por_faixa AS (
    SELECT
        h.ORDEM,
        COUNT(DISTINCT b.CODFUNCCONF) AS QT_USUARIOS_CONFERINDO
    FROM horarios_transformados h
    JOIN base_dados b ON
        b.CODFUNCCONF IS NOT NULL
        AND b.DATA_HORA_REFERENCIA_CONF IS NOT NULL
        AND (
            (b.DATA_HORA_REFERENCIA_CONF >= TRUNC(b.DATA_HORA_REFERENCIA_CONF) + h.FRACT_HORA_INI
             AND b.DATA_HORA_REFERENCIA_CONF < TRUNC(b.DATA_HORA_REFERENCIA_CONF) + h.FRACT_HORA_FIM)
            OR
            (h.HORA_FIM = '00:00' AND
             b.DATA_HORA_REFERENCIA_CONF >= TRUNC(b.DATA_HORA_REFERENCIA_CONF) + h.FRACT_HORA_INI AND
             b.DATA_HORA_REFERENCIA_CONF < TRUNC(b.DATA_HORA_REFERENCIA_CONF) + 1)
        )
    GROUP BY h.ORDEM
),

horarios AS (
    SELECT
        CASE
            WHEN LEVEL BETWEEN 8 AND 24 THEN LEVEL - 7
            ELSE LEVEL + 17
        END AS ORDEM,
        TO_CHAR(TO_DATE('00:00','HH24:MI') + (LEVEL - 1)/24, 'HH24:MI') AS HORA_INI,
        TO_CHAR(TO_DATE('01:00','HH24:MI') + (LEVEL - 1)/24, 'HH24:MI') AS HORA_FIM
    FROM dual
    CONNECT BY LEVEL <= 24
),

obs_horarios AS (
    SELECT '07:00 - 08:00' AS FAIXA, 'REUNIÃO' AS OBS FROM DUAL UNION ALL
    SELECT '11:20 - 12:20', 'ALMOÇO' FROM DUAL UNION ALL
    SELECT '23:00 - 00:00', 'JANTAR' FROM DUAL
),

canais_por_faixa AS (
    SELECT
        ORDEM,
        LISTAGG(ROTA_AGRUPADA, ', ') WITHIN GROUP (ORDER BY ROTA_AGRUPADA) AS ROTAS
    FROM (
        SELECT DISTINCT
            h.ORDEM,
            CASE
                WHEN e.DESCRICAO IN ('MANACAPURU', 'NOVO AIRAO', 'RIO PRETO DA EVA', 'PRESIDENTE FIGUEIREDO', 'IRANDUBA',
'AUTAZES', 'RODOVIARIO 1', 'RODOVIARIO 2', 'RODOVIARIO 3') THEN 'INTERIOR'
                WHEN e.DESCRICAO = 'CAPITAL' THEN 'CAPITAL'
                WHEN e.DESCRICAO = 'FLUVIAL' THEN 'FLUVIAL'
                WHEN e.DESCRICAO = 'FILIAIS' THEN 'FILIAL'
                WHEN e.DESCRICAO = 'AGENDAMENTO' THEN 'AGENDAMENTO'
                WHEN e.DESCRICAO = 'CLIENTE RETIRA NO CD' THEN 'RETIRA'
                WHEN e.DESCRICAO = 'TOP CLIENTE' THEN 'TOP CLIENTE'
                WHEN e.DESCRICAO = 'AUTO SERVIÇO' THEN 'AUTO SERVIÇO'
                WHEN e.DESCRICAO IN ('BVB CAPITAL','BVB INT.RODOVIARIO-01','BVB INT.RODOVIARIO-02','BVB FRETE MINIMO') THEN 'BOA VISTA'
                ELSE 'OUTROS'
            END AS ROTA_AGRUPADA
        FROM base_dados m
        JOIN PCCARREG g ON g.NUMCAR = m.NUMCAR
        JOIN PCROTAEXP e ON e.CODROTA = g.CODROTAPRINC
        JOIN horarios_transformados h ON
            m.DATA_HORA_REFERENCIA >= TRUNC(m.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
            AND m.DATA_HORA_REFERENCIA < TRUNC(m.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
    ) sub
    GROUP BY ORDEM
),

agrupado AS (
    SELECT
        h.ORDEM,
        h.HORA_INI || ' - ' || h.HORA_FIM AS FAIXA_HORARIA,

        COUNT(DISTINCT CASE
            WHEN b.ORIGEM = 'APANHA'
                AND b.DATA_HORA_REAL >= TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_INI
                AND (
                    ((h.HORA_FIM <> '00:00' AND b.DATA_HORA_REAL < TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_FIM))
                    OR
                    ((h.HORA_FIM = '00:00' AND b.DATA_HORA_REAL < TRUNC(b.DATA_HORA_REAL) + 1))
                )
            THEN b.NUMOS || '-' || b.CODENDERECO END
        ) AS APANHAS_MONTADAS,

        COUNT(DISTINCT CASE
            WHEN b.TIPOOS IN (10,12, 16, 20) AND b.QT = b.QTSEPARADA
                                                AND b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.NUMOS || '-' || b.CODENDERECO END) AS APANHAS_RUA,

        SUM(CASE
            WHEN b.TIPOOS IN (10,12, 16, 20) AND b.QTUNITCX > 0
                                                AND b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.QTSEPARADA / b.QTUNITCX
            ELSE 0 END) AS QT_SEP_EM_CX,

        COUNT(DISTINCT CASE
            WHEN b.TIPOOS IN (13, 22) AND b.QT = b.QTSEPARADA
                                                AND b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.NUMOS || '-' || b.CODENDERECO END) AS APANHAS_CHECKOUT,

        SUM(CASE
            WHEN b.TIPOOS IN (13, 22)
                                                AND b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.QTSEPARADA
            ELSE 0 END) AS QT_SEP_UNIDADES,

        COUNT(DISTINCT CASE
            WHEN b.QT = b.QTSEPARADA
                                                AND b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.NUMOS || '-' || b.CODENDERECO END) AS TOTAL_SEPARADO,

        COUNT(DISTINCT CASE
            WHEN b.DTFIMSEPARACAO IS NULL
                                                AND b.DATA_HORA_REAL >= TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_INI
                                                AND b.DATA_HORA_REAL < TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_FIM
            THEN b.NUMOS || '-' || b.CODENDERECO END) AS APANHAS_PENDENTES,

        COUNT(DISTINCT CASE
            WHEN b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI
                AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM
            THEN b.CODFUNCOS
        END) AS QT_USUARIOS_SEPARANDO
    FROM horarios_transformados h
    LEFT JOIN base_dados b ON (
            (b.ORIGEM = 'APANHA' AND
                b.DATA_HORA_REAL >= TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_INI AND
                (
                    ((h.HORA_FIM <> '00:00' AND b.DATA_HORA_REAL < TRUNC(b.DATA_HORA_REAL) + h.FRACT_HORA_FIM))
                    OR
                    ((h.HORA_FIM = '00:00' AND b.DATA_HORA_REAL < TRUNC(b.DATA_HORA_REAL) + 1))
                ))
            OR
            (b.DATA_HORA_REFERENCIA >= TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_INI AND
                (
                    ((h.HORA_FIM <> '00:00' AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + h.FRACT_HORA_FIM))
                    OR
                    ((h.HORA_FIM = '00:00' AND b.DATA_HORA_REFERENCIA < TRUNC(b.DATA_HORA_REFERENCIA) + 1))
                ))
    )
    GROUP BY h.ORDEM, h.HORA_INI, h.HORA_FIM
),

recursiva_apend (
    ORDEM,
    FAIXA_HORARIA,
    APANHAS_MONTADAS,
    APANHAS_RUA,
    QT_SEP_EM_CX,
    APANHAS_CHECKOUT,
    QT_SEP_UNIDADES,
    TOTAL_SEPARADO,
    SALDO_PENDENTE,
    QT_USUARIOS_SEPARANDO,
    QT_USUARIOS_CONFERINDO,
    ROTAS
) AS (
    SELECT
        a.ORDEM,
        a.FAIXA_HORARIA,
        a.APANHAS_MONTADAS,
        a.APANHAS_RUA,
        a.QT_SEP_EM_CX,
        a.APANHAS_CHECKOUT,
        a.QT_SEP_UNIDADES,
        a.TOTAL_SEPARADO,
        (a.APANHAS_MONTADAS + p.SALDO_INICIAL) - a.TOTAL_SEPARADO AS SALDO_PENDENTE,
        a.QT_USUARIOS_SEPARANDO,
        c.QT_USUARIOS_CONFERINDO AS QT_USUARIOS_CONFERINDO,
        cpf.ROTAS
    FROM agrupado a
    LEFT JOIN obs_horarios o ON a.FAIXA_HORARIA = o.FAIXA
    LEFT JOIN canais_por_faixa cpf ON a.ORDEM = cpf.ORDEM
    LEFT JOIN conferentes_por_faixa c ON a.ORDEM = c.ORDEM
    CROSS JOIN saldo_inicial_pendencias p
    WHERE a.ORDEM = 1

    UNION ALL

    SELECT
        a.ORDEM,
        a.FAIXA_HORARIA,
        a.APANHAS_MONTADAS,
        a.APANHAS_RUA,
        a.QT_SEP_EM_CX,
        a.APANHAS_CHECKOUT,
        a.QT_SEP_UNIDADES,
        a.TOTAL_SEPARADO,
        (r.SALDO_PENDENTE - a.TOTAL_SEPARADO) + a.APANHAS_MONTADAS AS SALDO_PENDENTE,
        a.QT_USUARIOS_SEPARANDO,
        c.QT_USUARIOS_CONFERINDO AS QT_USUARIOS_CONFERINDO,
        cpf.ROTAS
    FROM agrupado a
    JOIN recursiva_apend r ON a.ORDEM = r.ORDEM + 1
    LEFT JOIN obs_horarios o ON a.FAIXA_HORARIA = o.FAIXA
    LEFT JOIN canais_por_faixa cpf ON a.ORDEM = cpf.ORDEM
    LEFT JOIN conferentes_por_faixa c ON a.ORDEM = c.ORDEM
)
SELECT *
FROM recursiva_apend
WHERE ORDEM <= 17
ORDER BY ORDEM
`;

// ================== CACHE EM MEMÓRIA ==================
let cachedApanhas = [];
let lastUpdate = null;
let isUpdating = false;
const AUTO_REFRESH_MINUTES = 2;

// FUNÇÃO QUE REALMENTE EXECUTA A QUERY NO SERVIDOR
async function atualizarCacheApanhas() {
  if (isUpdating) return;

  let conn;
  try {
    isUpdating = true;

    const dataHoje = getDataHojeDDMMYYYY();
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      SQL_APANHAS,
      {
        DATAPEND: dataHoje,
        DATATURNO: dataHoje
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );

    cachedApanhas = result.rows || [];
    lastUpdate = new Date();

    console.log('CACHE /api/apanhas ATUALIZADO EM', lastUpdate.toISOString());

    // ENVIA PARA TODAS AS PÁGINAS CONECTADAS
    io.emit('apanhasAtualizado', {
      data: cachedApanhas,
      lastUpdate
    });

  } catch (err) {
    console.error('ERRO AO ATUALIZAR CACHE /api/apanhas:', err);
  } finally {
    isUpdating = false;
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.error('ERRO AO FECHAR CONEXAO:', e);
      }
    }
  }
}

// ATUALIZAÇÃO AUTOMÁTICA APENAS NO SERVIDOR
setInterval(() => {
  atualizarCacheApanhas().catch(err => {
    console.error('ERRO NA ATUALIZAÇÃO AUTOMÁTICA:', err);
  });
}, AUTO_REFRESH_MINUTES * 60 * 1000);

// PRIMEIRA CARGA AO SUBIR O SERVIDOR
atualizarCacheApanhas().catch(err => {
  console.error('ERRO NA PRIMEIRA ATUALIZAÇÃO DO CACHE:', err);
});

// ================== ROTA /API/APANHAS ==================
app.get('/api/apanhas', async (req, res) => {
  try {
    const force =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      req.query.force === 'sim';

    if (force || !cachedApanhas) {
      await atualizarCacheApanhas();
    }

    res.json({
      data: cachedApanhas || [],
      lastUpdate: lastUpdate ? lastUpdate.toISOString() : null
    });
  } catch (err) {
    console.error('ERRO NA ROTA /api/apanhas:', err);
    res.status(500).json({ error: true, message: err.message });
  }
});

// ================== SOCKET.IO (LOG SIMPLES) ==================
io.on('connection', (socket) => {
  console.log('CLIENTE CONECTADO VIA WEBSOCKET:', socket.id);

  // ENVIA O ESTADO ATUAL ASSIM QUE CONECTAR
  socket.emit('apanhasAtualizado', {
    data: cachedApanhas,
    lastUpdate
  });

  socket.on('disconnect', () => {
    console.log('CLIENTE DESCONECTADO:', socket.id);
  });
});

// ================== START SERVER ==================
// 0.0.0.0 -> PERMITE ACESSO VIA IP DO SERVIDOR (EX.: 192.168.8.27)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SERVIDOR RODANDO NA PORTA ${PORT}`);
  console.log(`➡ ACESSO LOCAL:  http://localhost:${PORT}`);
  console.log('➡ ACESSO NA REDE: use o IP real do servidor, por exemplo:');
  console.log(`   http://192.168.8.27:${PORT}`);
});
