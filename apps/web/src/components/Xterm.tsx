import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useStore } from '../store.ts';

export interface XtermHandle {
  write(text: string): void;
  clear(): void;
  find(query: string, backwards?: boolean): void;
  fit(): void;
  size(): { cols: number; rows: number };
}

function themeFor(mode: 'dark' | 'light') {
  return mode === 'dark'
    ? {
        background: '#0b0f14',
        foreground: '#d7dde5',
        cursor: '#2dd4bf',
        selectionBackground: '#2c3a48',
        black: '#10151c',
        brightBlack: '#6f7b8a',
        red: '#ff7a7a',
        green: '#5ee08f',
        yellow: '#f5b544',
        blue: '#7fb2ff',
        magenta: '#bda6ff',
        cyan: '#2dd4bf',
        white: '#d7dde5',
      }
    : {
        background: '#fbfbfa',
        foreground: '#1e252c',
        cursor: '#0b8f80',
        selectionBackground: '#c9dcd8',
        black: '#171c22',
        brightBlack: '#7a8490',
        red: '#c93636',
        green: '#17803d',
        yellow: '#9a6200',
        blue: '#2563c9',
        magenta: '#6b46c9',
        cyan: '#0b7f72',
        white: '#434c57',
      };
}

export function Xterm({
  ref,
  readOnly = false,
  onData,
  onResize,
  onReady,
}: {
  ref?: Ref<XtermHandle>;
  readOnly?: boolean;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const theme = useStore((state) => state.theme);
  const callbacks = useRef({ onData, onResize, onReady });
  callbacks.current = { onData, onResize, onReady };

  useImperativeHandle(ref, () => ({
    write: (text) => terminal.current?.write(text),
    // Pela fila de escrita, para não ser atropelado por algo que ainda vai ser desenhado.
    clear: () => terminal.current?.write('\x1bc'),
    find: (query, backwards) => {
      if (backwards) search.current?.findPrevious(query);
      else search.current?.findNext(query);
    },
    fit: () => fitAddon.current?.fit(),
    size: () => ({ cols: terminal.current?.cols ?? 80, rows: terminal.current?.rows ?? 24 }),
  }), []);

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      cursorInactiveStyle: readOnly ? 'none' : 'outline',
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 20_000,
      allowProposedApi: true,
      theme: themeFor(useStore.getState().theme),
    });
    const fit = new FitAddon();
    const finder = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(finder);
    term.open(host.current!);
    terminal.current = term;
    fitAddon.current = fit;
    search.current = finder;

    const dataListener = term.onData((data) => callbacks.current.onData?.(data));
    const resizeListener = term.onResize(({ cols, rows }) => callbacks.current.onResize?.(cols, rows));

    // Copiar a seleção com Ctrl+C sem interromper quando não há nada selecionado.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      return true;
    });

    const safeFit = () => {
      if (host.current && host.current.offsetWidth > 0 && host.current.offsetHeight > 0) fit.fit();
    };
    const observer = new ResizeObserver(safeFit);
    observer.observe(host.current!);
    safeFit();
    callbacks.current.onReady?.();

    return () => {
      observer.disconnect();
      dataListener.dispose();
      resizeListener.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = themeFor(theme);
  }, [theme]);

  return <div ref={host} className="h-full w-full overflow-hidden" style={{ background: 'var(--term-bg, transparent)' }} />;
}
