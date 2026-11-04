// `npm run doctor`: mostra o que o XinoIA enxerga neste computador, com dados reais.
import { createConfig } from './config.ts';
import { createContext } from './context.ts';

const line = (text = '') => process.stdout.write(`${text}\n`);

const ctx = await createContext(createConfig());
const providers = await ctx.detection.refresh();

line(`Dados: ${ctx.config.dataDir}`);
line(`Esquema do banco: v${await ctx.db.schemaVersion()}`);
line();
line('Ferramentas de IA');
for (const provider of providers) {
  if (!provider.installed) {
    line(`  [ ] ${provider.label}: não instalado${provider.installCommand ? ` (${provider.installCommand})` : ''}`);
    continue;
  }
  const caps = Object.entries(provider.capabilities).map(([name, ok]) => `${ok ? '+' : '-'}${name}`).join(' ');
  line(`  [x] ${provider.label}: ${provider.version} ${caps}`);
}
line();
const profiles = await ctx.profiles.checkAll();
line(`Perfis cadastrados: ${profiles.length}`);
for (const profile of profiles) {
  const auth = profile.auth;
  const state = !auth?.loggedIn
    ? 'sem login'
    : auth.subscription === false
      ? 'login por API, não assinatura'
      : `logado (${auth.method ?? 'método não informado'})`;
  line(`  - ${profile.label} [${profile.provider}]: ${state}`);
}
await ctx.close();
