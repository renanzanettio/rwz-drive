/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O Next.js roda atrás do Cloudflare Tunnel; ele mesmo escuta só em
  // localhost (spec §20). Nada aqui precisa saber do domínio público.
  output: "standalone",
};

module.exports = nextConfig;
