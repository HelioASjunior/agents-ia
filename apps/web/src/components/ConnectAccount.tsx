import { CheckCircle2, CircleAlert, Download, ExternalLink, Globe, KeyRound, RefreshCw, TerminalSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Profile, ProviderInfo, TerminalInfo } from '@xinoia/shared';
import { api, ApiError } from '../api.ts';
import { useStore } from '../store.ts';
import { PtyTerminal } from './PtyTerminal.tsx';
import { Button, Dialog, Field } from './ui.tsx';

const POLL_MS = 2500;
// Alguns CLIs perguntam algo antes de abrir o navegador: sem endereço, mostra o terminal.
const SHOW_TERMINAL_AFTER_MS = 12_000;

/** Login oficial pelo navegador. Fecha sozinho quando o próprio CLI confirma a conta. */
export function BrowserLogin({ profile, providerLabel, onClose }: { profile: Profile; providerLabel: string; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const toast = useStore((state) => state.toast);
  const [terminal, setTerminal] = useState<TerminalInfo | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const terminalRef = useRef<TerminalInfo | null>(null);
  const closing = useRef(false);
  // Refazendo o login de uma conta conectada, o estado não muda: quem decide é o botão.
  const wasConnected = useRef(Boolean(profile.auth?.loggedIn));

  useEffect(() => {
    let live = true;
    void run(() => api.post<TerminalInfo>('/api/terminals', { kind: 'login', profileId: profile.id })).then((created) => {
      if (live && created) {
        terminalRef.current = created;
        setTerminal(created);
      } else if (created) {
        void api.delete(`/api/terminals/${created.id}`).catch(() => undefined);
      }
    });
    return () => {
      live = false;
      if (terminalRef.current) void api.delete(`/api/terminals/${terminalRef.current.id}`).catch(() => undefined);
    };
  }, [profile.id, run]);

  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    await run(() => api.post(`/api/profiles/${profile.id}/check`));
    onClose();
  };

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        const current = terminalRef.current;
        if (current) {
          const found = await api.get<{ url: string | null }>(`/api/terminals/${current.id}/link`).catch((error: unknown) => {
            // O terminal já terminou: não há mais o que ler.
            if (error instanceof ApiError && error.status === 404) terminalRef.current = null;
            return null;
          });
          if (found?.url) setLink(found.url);
        }
        const checked = await api.post<Profile>(`/api/profiles/${profile.id}/check`).catch(() => null);
        if (checked?.auth?.loggedIn && !wasConnected.current && !closing.current) {
          toast('ok', `${providerLabel} conectado.`);
          void finish();
        }
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => {
    const timer = setTimeout(() => setLink((current) => {
      if (!current) setShowTerminal(true);
      return current;
    }), SHOW_TERMINAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog
      title={`Entrar: ${providerLabel}`}
      onClose={() => void finish()}
      width={showTerminal ? 760 : 480}
      footer={(
        <>
          <Button kind="ghost" onClick={() => setShowTerminal(!showTerminal)}><TerminalSquare size={13} /> {showTerminal ? 'Esconder terminal' : 'Ver terminal'}</Button>
          <Button kind="primary" onClick={() => void finish()}>Terminei</Button>
        </>
      )}
    >
      <div className="flex flex-col items-center py-2 text-center">
        <span className="pulse flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Globe size={28} /></span>
        <p className="mt-3 font-display text-base font-semibold">Continue no navegador</p>
        <p className="mt-1 max-w-sm text-[13px] text-soft">
          Entre com a sua conta na página oficial, do jeito que você entra normalmente, inclusive com o Google, se a sua conta usar. Esta janela fecha sozinha quando terminar.
        </p>
        {link && <a className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent underline" href={link} target="_blank" rel="noreferrer noopener">Abrir a página de novo <ExternalLink size={12} /></a>}
        <p className="mt-3 text-xs text-muted">Sua senha e seus tokens nunca passam pelo XinoIA.</p>
      </div>
      {showTerminal && (
        <>
          <p className="mb-2 mt-3 text-xs text-muted">Se a ferramenta perguntar algo, ou o navegador mostrar um código, responda aqui.</p>
          <div className="h-64 overflow-hidden rounded-lg border border-line bg-bg">
            {terminal ? <PtyTerminal terminalId={terminal.id} onExit={() => { terminalRef.current = null; }} /> : <p className="p-3 text-xs text-muted">Abrindo…</p>}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Conta paga por uso: a chave fica cifrada pelo Windows e não volta para a tela. */
export function ApiKeyDialog({ provider, profile, onClose }: { provider: ProviderInfo; profile?: Profile; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [label, setLabel] = useState('Chave de API');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const saved = profile
      ? await run(() => api.put<Profile>(`/api/profiles/${profile.id}/api-key`, { apiKey }), 'Chave trocada.')
      : await run(() => api.post<Profile>('/api/profiles', { provider: provider.id, label, apiKey }), 'Chave guardada.');
    if (saved && !profile) await run(() => api.post(`/api/profiles/${saved.id}/check`));
    setApiKey('');
    setSaving(false);
    if (saved) {
      await loadCatalog();
      onClose();
    }
  };

  return (
    <Dialog
      title={profile ? `Trocar a chave: ${profile.label}` : `Usar chave de API: ${provider.label}`}
      onClose={onClose}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>Cancelar</Button>
          <Button kind="primary" disabled={saving || apiKey.trim().length < 8 || !label.trim()} onClick={() => void save()}>Guardar chave</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-[13px] text-amber">Com chave de API, cada uso é cobrado pelo fornecedor, à parte da sua assinatura.</p>
        {!profile && <Field label="Nome da conta"><input className="field" value={label} onChange={(event) => setLabel(event.target.value)} /></Field>}
        <Field label="Chave de API" hint="Fica cifrada pelo Windows, presa ao seu usuário, e só é entregue à ferramenta ao executar.">
          <input autoFocus type="password" autoComplete="off" spellCheck={false} className="field font-mono" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </Field>
        {provider.apiKeyUrl && <a className="inline-flex items-center gap-1 text-xs text-accent underline" href={provider.apiKeyUrl} target="_blank" rel="noreferrer noopener">Criar uma chave no site oficial <ExternalLink size={11} /></a>}
      </div>
    </Dialog>
  );
}

/** Roda o instalador oficial à vista de quem clicou, sem nenhum atalho. */
export function InstallDialog({ provider, onClose }: { provider: ProviderInfo; onClose: () => void }) {
  const run = useStore((state) => state.run);
  const loadCatalog = useStore((state) => state.loadCatalog);
  const [terminal, setTerminal] = useState<TerminalInfo | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let live = true;
    void run(() => api.post<TerminalInfo>('/api/terminals', { kind: 'install', provider: provider.id })).then((created) => {
      if (live && created) setTerminal(created);
    });
    return () => {
      live = false;
    };
  }, [provider.id, run]);

  const close = async () => {
    await run(() => api.post('/api/providers/refresh'));
    await loadCatalog();
    onClose();
  };

  return (
    <Dialog title={`Instalar ${provider.label}`} onClose={() => void close()} width={760} footer={<Button kind="primary" onClick={() => void close()}>{ended ? 'Concluir' : 'Fechar'}</Button>}>
      <p className="mb-2 text-[13px] text-soft">Este é o instalador oficial, e o XinoIA só mostra o que ele faz.</p>
      <p className="mb-2 break-all rounded bg-hover px-2 py-1 font-mono text-xs">{provider.installCommand}</p>
      <div className="h-72 overflow-hidden rounded-lg border border-line bg-bg">
        {terminal ? <PtyTerminal terminalId={terminal.id} onExit={() => setEnded(true)} /> : <p className="p-3 text-xs text-muted">Abrindo…</p>}
      </div>
      {provider.installCommand?.startsWith('npm') && <p className="mt-2 text-xs text-muted">Este instalador precisa do <a className="text-accent underline" href="https://nodejs.org" target="_blank" rel="noreferrer noopener">Node.js</a>. Se aparecer que o npm não existe, instale o Node.js e tente de novo.</p>}
    </Dialog>
  );
}

/** Cartão para escolher uma IA: instalar, entrar pelo navegador ou usar chave de API. */
export function ProviderChoice({ provider }: { provider: ProviderInfo }) {
  const allProfiles = useStore((state) => state.profiles);
  const run = useStore((state) => state.run);
  const profiles = allProfiles.filter((profile) => profile.provider === provider.id);
  const connected = profiles.find((profile) => profile.auth?.loggedIn);
  const main = profiles.find((profile) => !profile.homeDir);
  const [dialog, setDialog] = useState<'login' | 'key' | 'install' | null>(null);

  const status = !provider.installed
    ? 'Ainda não instalado'
    : !connected
      ? 'Instalado, falta entrar'
      : connected.credential === 'api_key'
        ? 'Conectado por chave de API: cobrança por uso'
        : connected.auth?.plan
          ? `Assinatura conectada, plano ${connected.auth.plan}`
          : 'Conectado';

  return (
    <li className="rounded-xl border border-line bg-raised p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {connected ? <CheckCircle2 size={20} className="shrink-0 text-ok" /> : <CircleAlert size={20} className="shrink-0 text-muted" />}
        <div className="min-w-40 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {provider.label}
            {provider.support === 'documented' && <span className="rounded bg-hover px-1.5 text-[11px] font-normal text-muted">ainda não testado</span>}
          </p>
          <p className="text-xs text-muted">{status}</p>
        </div>
        {!provider.installed && provider.installCommand && <Button size="sm" kind="primary" onClick={() => setDialog('install')}><Download size={13} /> Instalar</Button>}
        {provider.installed && !connected && provider.canLogin && main && <Button size="sm" kind="primary" onClick={() => setDialog('login')}><Globe size={13} /> Entrar pelo navegador</Button>}
        {provider.installed && provider.supportsApiKey && !profiles.some((profile) => profile.credential === 'api_key') && <Button size="sm" kind={connected ? 'ghost' : 'outline'} onClick={() => setDialog('key')}><KeyRound size={13} /> Usar chave de API</Button>}
        {provider.installed && main && <Button size="sm" kind="ghost" onClick={() => void run(() => api.post(`/api/profiles/${main.id}/check`))} aria-label={`Verificar ${provider.label} de novo`}><RefreshCw size={13} /></Button>}
      </div>
      {dialog === 'login' && main && <BrowserLogin profile={main} providerLabel={provider.label} onClose={() => setDialog(null)} />}
      {dialog === 'key' && <ApiKeyDialog provider={provider} onClose={() => setDialog(null)} />}
      {dialog === 'install' && <InstallDialog provider={provider} onClose={() => setDialog(null)} />}
    </li>
  );
}
