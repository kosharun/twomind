/**
 * Secret redaction.
 *
 * This runs over every prompt and every AI summary before anything is written
 * to a file that could be committed. It is deliberately eager: a false positive
 * costs a bit of readability, a false negative leaks a credential.
 *
 * It does NOT run over code diffs: those are already in your repository, and
 * rewriting them would make the before/after view lie about what is on disk.
 */

interface Rule {
  name: string;
  re: RegExp;
  /** Replace the whole match, or just capture group 1 if `group` is set. */
  group?: number;
}

const RULES: Rule[] = [
  { name: 'private-key', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g },
  { name: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Connection strings with inline credentials: scheme://user:pass@host
  { name: 'connection-string', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+(@)/gi, group: 0 },
  // KEY=value / "key": "value" where the key name smells like a secret
  {
    name: 'secret-assignment',
    re: /\b((?:[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|PASSPHRASE|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET|AUTH)[A-Za-z0-9_]*)\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
    group: 2,
  },
];

export interface RedactResult {
  text: string;
  hits: string[];
}

export function redact(input: string): RedactResult {
  if (!input) return { text: input, hits: [] };
  let text = input;
  const hits: string[] = [];

  for (const rule of RULES) {
    text = text.replace(rule.re, (match, ...groups) => {
      hits.push(rule.name);
      if (rule.name === 'connection-string') {
        // Keep scheme://user: and @host, mask only the password.
        const prefix = groups[0] as string;
        const at = groups[1] as string;
        return `${prefix}[redacted]${at}`;
      }
      if (rule.group === 2) {
        const keyPart = groups[0] as string;
        return `${keyPart}[redacted:secret]`;
      }
      return `[redacted:${rule.name}]`;
    });
  }

  return { text, hits: Array.from(new Set(hits)) };
}

/** True when the text looks like it contained something that should never be committed. */
export function hasSecrets(input: string): boolean {
  return redact(input).hits.length > 0;
}
