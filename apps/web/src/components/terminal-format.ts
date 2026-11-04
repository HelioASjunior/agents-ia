import type { AgentEvent, Run } from '@xinoia/shared';

const RESET = '\x1b[0m';
const color = (code: string, text: string) => `\x1b[${code}m${text}${RESET}`;
const DIM = '90';
const OUTPUT_LINES = 40;

export function agentPrefix(name: string, hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `\x1b[38;2;${r};${g};${b}m${name.padEnd(9).slice(0, 9)}${RESET} ${color(DIM, '│')} `;
}

export function runHeader(run: Run, projectPath: string): string[] {
  const lines = [color('36;1', `${projectPath}> ${run.command ?? run.provider}`)];
  return lines;
}

function lines(text: string, code?: string): string[] {
  return text.split(/\r?\n/).map((line) => (code ? color(code, line) : line));
}

/**
 * Transforma um evento real em linhas do terminal. `text` é tratado à parte pelo
 * componente, porque chega em pedaços no meio da linha.
 */
export function formatEvent(event: AgentEvent, showNoise: boolean): string[] {
  switch (event.type) {
    case 'session':
      return event.model ? [color(DIM, `modelo: ${event.model}`)] : [];
    case 'thinking':
      return lines(event.text, DIM);
    case 'tool_start':
      return [color('33', `▸ ${event.name}: `) + (event.command ?? event.summary)];
    case 'tool_end': {
      const output = event.output.trimEnd();
      if (!output) return event.ok ? [] : [color('31', 'a ferramenta falhou')];
      const all = output.split(/\r?\n/);
      const shown = all.slice(0, OUTPUT_LINES).map((line) => (event.ok ? color(DIM, `  ${line}`) : color('31', `  ${line}`)));
      if (all.length > OUTPUT_LINES) shown.push(color(DIM, `  … mais ${all.length - OUTPUT_LINES} linhas`));
      return shown;
    }
    case 'usage':
      return [color(DIM, `tokens informados: ${event.inputTokens} entrada, ${event.outputTokens} saída`)];
    case 'limits':
      return event.status && event.status !== 'allowed' ? [color('33', `limite da conta: ${event.status}`)] : [];
    case 'warning':
      return lines(`aviso: ${event.text}`, '33');
    case 'error':
      return lines(`erro: ${event.text}`, '31');
    case 'stderr':
      return lines(event.text, '31');
    case 'raw':
      return lines(event.text);
    case 'noise':
      return showNoise ? lines(event.text, DIM) : [];
    case 'final':
      return event.error ? lines(`erro: ${event.error}`, '31') : [];
    default:
      return [];
  }
}

export function runFooter(run: Run): string[] {
  const seconds = run.startedAt && run.endedAt ? ` em ${Math.round((run.endedAt - run.startedAt) / 1000)}s` : '';
  switch (run.status) {
    case 'completed':
      return [color('32', `✓ concluído${seconds}`)];
    case 'failed':
      return [color('31', `✗ falhou${seconds}${run.exitCode !== null ? ` (código ${run.exitCode})` : ''}`)];
    case 'cancelled':
      return [color('33', `■ interrompido${seconds}`)];
    case 'interrupted':
      return [color('33', '■ o XinoIA foi fechado durante esta execução')];
    default:
      return [];
  }
}
