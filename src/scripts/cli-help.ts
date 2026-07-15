export interface HelpSpec {
  usage: string;
  description: string;
  example: string;
}

export function maybeHelp(argv: string[], spec: HelpSpec): void {
  if (!argv.includes('--help') && !argv.includes('-h')) return;
  console.log(['', `  ${spec.usage}`, '', `  ${spec.description}`, '', `  example: ${spec.example}`, ''].join('\n'));
  process.exit(0);
}

export function parseFlags(argv: string[]): { json: boolean; rest: string[] } {
  const json = argv.includes('--json') || process.env.npm_config_json === 'true';
  return {
    json,
    rest: argv.filter((arg) => arg !== '--json' && arg !== '--help' && arg !== '-h'),
  };
}

export function doctorVerdict(blocking: string[]): { exitCode: 0 | 1; line: string } {
  if (blocking.length === 0) return { exitCode: 0, line: '  ✅ READY — no blocking issues' };
  return {
    exitCode: 1,
    line: `  ❌ NOT READY — ${blocking.length} blocking issue(s): ${blocking.join(', ')}`,
  };
}
