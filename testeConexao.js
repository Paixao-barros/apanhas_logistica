const oracledb = require("oracledb");

try {
  if (process.platform === "win32") {
    // Caminho no Windows
    oracledb.initOracleClient({
      libDir: "C:\\InstantClient\\instantclient_21_19"
    });
  } else if (process.platform === "linux") {
    // Caminho no WSL/Linux
    oracledb.initOracleClient({
      libDir: "/opt/oracle/instantclient_21_19/instantclient_21_20"
    });
  }

  console.log("CLIENTE ORACLE INICIALIZADO");
} catch (err) {
  console.error("ERRO AO INICIALIZAR O CLIENT ORACLE:");
  console.error(err);
  process.exit(1);
}


const dbConfig = {
  user: "dunorte",
  password: "",
  connectString: `
    (DESCRIPTION =
      (ADDRESS = (PROTOCOL = TCP)(HOST = odamedei-scan)(PORT = 1521))
      (CONNECT_DATA =
        (SERVER = DEDICATED)
        (SERVICE_NAME = WINT.dnor.local)
      )
    )
  `
};


async function testarConexao() {
  let conn;

  try {
    console.log("➡ CONECTANDO AO BANCO ORACLE...");

    conn = await oracledb.getConnection(dbConfig);

    console.log("✔ CONEXÃO ESTABELECIDA!");

    const sql = `
      SELECT *
      FROM PCCARREG
      FETCH FIRST 5 ROWS ONLY
    `;

    const result = await conn.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    console.log("RESULTADO DA CONSULTA:");
    console.log(result.rows);

  } catch (err) {
    console.error("ERRO NA CONEXÃO/CONSULTA:");
    console.error(err);
  } finally {
    if (conn) {
      await conn.close();
      console.log("CONEXÃO FECHADA.");
    }
  }
}

testarConexao();
