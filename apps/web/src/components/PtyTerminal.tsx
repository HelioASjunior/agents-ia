import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api.ts';
import { Xterm, type XtermHandle } from './Xterm.tsx';

/** Terminal interativo de verdade, ligado a um processo por PTY no servidor. */
export function PtyTerminal({ terminalId, onExit }: { terminalId: string; onExit?: (code: number) => void }) {
  const term = useRef<XtermHandle>(null);
  const socket = useRef<WebSocket | null>(null);
  const [exited, setExited] = useState<number | null>(null);

  const sendSize = useCallback((cols: number, rows: number) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl(`/ws/terminal/${terminalId}`));
    socket.current = ws;
    ws.onopen = () => {
      const size = term.current?.size();
      if (size) sendSize(size.cols, size.rows);
    };
    ws.onmessage = (raw) => {
      const message = JSON.parse(String(raw.data)) as { type: 'data'; data: string } | { type: 'exit'; code: number };
      if (message.type === 'data') {
        term.current?.write(message.data);
      } else {
        term.current?.write(`\r\n\x1b[90m[processo encerrado com código ${message.code}]\x1b[0m\r\n`);
        setExited(message.code);
        onExit?.(message.code);
      }
    };
    return () => ws.close();
  }, [terminalId, sendSize]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full min-h-0" data-exited={exited ?? undefined}>
      <Xterm
        ref={term}
        onData={(data) => {
          if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'input', data }));
        }}
        onResize={sendSize}
      />
    </div>
  );
}
