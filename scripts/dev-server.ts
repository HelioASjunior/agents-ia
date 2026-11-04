// Servidor para desenvolvimento: dados em .xinoia-dev, para não misturar com os dados
// do XinoIA instalado, e porta fixa, para o Vite encontrar a API.
process.env.XINOIA_DATA_DIR ??= new URL('../.xinoia-dev', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
process.env.XINOIA_PORT ??= '4317';
process.env.XINOIA_DEV_ORIGIN ??= 'http://localhost:5173';

await import('../apps/server/src/index.ts');
