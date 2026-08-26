module.exports = {
  apps: [
    {
      name: "drive-api",
      cwd: "./drive-api",
      script: "dist/server.js",
      env: {
        NODE_ENV: "production",
        // PORT/CORS_ORIGIN etc. vêm do drive-api/.env (dotenv) — não duplicar aqui.
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: "../logs/drive-api.out.log",
      error_file: "../logs/drive-api.err.log",
      time: true,
    },
    {
      // Modo "standalone": o Next.js foi buildado no PC (npm run build com
      // output: "standalone" no next.config.js) e só o resultado foi
      // transferido para o celular — ver docs/TERMUX.md, seção
      // "Build no PC / deploy standalone". Isso evita rodar o webpack
      // build (pesado) dentro do Termux, e também dispensa `npm install`
      // completo no celular para o frontend (o server.js já vem com um
      // node_modules mínimo embutido).
      name: "drive-web",
      cwd: "./drive-web/.next/standalone",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3010",
        HOSTNAME: "127.0.0.1",
        API_INTERNAL_URL: "http://127.0.0.1:3011",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: "../../../logs/drive-web.out.log",
      error_file: "../../../logs/drive-web.err.log",
      time: true,
    },
  ],
};
