// logger.js
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');

// Garante que a pasta logs exista
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

function writeLog(level, message, error) {
  const now = new Date();
  const timestamp = now.toISOString();           // ex: 2025-12-09T13:20:15.123Z
  const dateStr = timestamp.substring(0, 10);    // ex: 2025-12-09

  let line = `[${timestamp}] [${level}] ${message}`;

  if (error) {
    // Inclui mensagem e stack do erro
    const errMsg = error.message || String(error);
    const stack = error.stack || '';
    line += ` | errMsg=${errMsg} | stack=${stack}`;
  }

  line += '\n';

  const fileName = `apanhas_${dateStr}.log`;     // um arquivo por dia
  const fullPath = path.join(LOG_DIR, fileName);

  fs.appendFile(fullPath, line, (err) => {
    if (err) {
      // Se der erro até pra logar, pelo menos mostra no console.
      console.error('FALHA AO ESCREVER LOG:', err);
    }
  });
}

module.exports = {
  info(message) {
    console.log(message);
    writeLog('INFO', message);
  },

  warn(message) {
    console.warn(message);
    writeLog('WARN', message);
  },

  error(message, error) {
    console.error(message, error || '');
    writeLog('ERROR', message, error);
  }
};
