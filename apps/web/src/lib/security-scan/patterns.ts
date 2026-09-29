import type { FlagSeverity } from './types'

export interface PatternDef {
  name: string
  severity: FlagSeverity
  description: string
  regex: RegExp
  kind: 'reject' | 'high' | 'medium' | 'pipe' | 'secret'
  skipCodeBlock?: boolean
}

export const REJECT_PATTERNS: PatternDef[] = [
  {
    name: 'exfil_secrets_combo',
    severity: 'critical',
    description: 'Exfiltrates secrets via pipe to network tool',
    kind: 'reject',
    regex: /(cat|type)\s+[^\n]*(?:\.env|id_rsa|credentials|secrets)[^\n]*\|\s*(curl|wget|nc)\b/i,
  },
  {
    name: 'backdoor_install',
    severity: 'critical',
    description: 'Installs backdoor via shell startup + remote download',
    kind: 'reject',
    regex: /(echo|printf).*(curl|wget).*(bashrc|zshrc|profile)/i,
  },
]

export const HIGH_RISK_PATTERNS: PatternDef[] = [
  {
    name: 'data_exfiltration',
    severity: 'high',
    description: 'Posts local data to a remote endpoint',
    kind: 'high',
    skipCodeBlock: true,
    regex: /curl\s+[^\n]*-d\s+\$\(/i,
  },
  {
    name: 'credential_harvest',
    severity: 'high',
    description: 'Harvests credentials from environment variables',
    kind: 'high',
    skipCodeBlock: true,
    regex: /env\s*\|\s*grep\s+-i\s+(key|token|secret|password)/i,
  },
  {
    name: 'env_file_read',
    severity: 'high',
    description: 'Reads .env or credential files',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\b(cat|type|Get-Content)\s+[^\n]*(\.env|credentials\.json|secrets\.json)\b/i,
  },
  {
    name: 'sensitive_dir_access',
    severity: 'high',
    description: 'Accesses ~/.ssh or other sensitive directories',
    kind: 'high',
    skipCodeBlock: true,
    regex: /(~|\$HOME)\/\.ssh|\/etc\/shadow|\/etc\/sudoers/i,
  },
  {
    name: 'etc_sensitive_read',
    severity: 'high',
    description: 'Reads /etc/shadow or sudoers',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\b(cat|less|more)\s+\/etc\/(shadow|sudoers)/i,
  },
  {
    name: 'agent_config_theft',
    severity: 'high',
    description: 'Reads agent configuration/session/credential files and sends them out',
    kind: 'high',
    skipCodeBlock: true,
    regex: /(~|\$HOME)\/\.(claude|codex|cursor|openclaw)[^\n]*\|\s*(curl|wget)/i,
  },
  {
    name: 'agent_memory_theft',
    severity: 'high',
    description: 'Reads agent memory/session files',
    kind: 'high',
    skipCodeBlock: true,
    regex: /(~|\$HOME)\/\.(claude|codex)\/.*(memory|session|history)/i,
  },
  {
    name: 'exec_import',
    severity: 'high',
    description: 'Dynamic code execution via exec/import',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\bexec\s*\(\s*__import__\s*\(/,
  },
  {
    name: 'base64_exec',
    severity: 'high',
    description: 'Decodes and executes a payload',
    kind: 'high',
    skipCodeBlock: true,
    regex: /base64\s+(-d|--decode)[^\n]*\|\s*(sh|bash|python|node)/i,
  },
  {
    name: 'chmod_dangerous',
    severity: 'high',
    description: 'Dangerous permission change (chmod 777)',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\bchmod\s+(-R\s+)?777\b/,
  },
  {
    name: 'privilege_escalation',
    severity: 'high',
    description: 'Attempts privilege escalation',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\b(chmod\s+u\+s|visudo|passwd\s+root)\b/i,
  },
  {
    name: 'service_persistence',
    severity: 'high',
    description: 'Installs persistence via launchctl/systemctl',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\b(launchctl\s+load|systemctl\s+--user\s+enable|crontab\s+-e)\b/i,
  },
  {
    name: 'reverse_shell',
    severity: 'high',
    description: 'Reverse shell / bind shell pattern',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\bnc\s+-[lp]\b|\/dev\/tcp\//i,
  },
  {
    name: 'dev_tcp',
    severity: 'high',
    description: 'Bash /dev/tcp reverse connection',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\/dev\/tcp\/[0-9.]+\/\d+/,
  },
  {
    name: 'rm_rf_root',
    severity: 'high',
    description: 'Destructive rm -rf targeting root or home',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\brm\s+(-rf|-fr)\s+(\/|~|\$HOME)\b/,
  },
  {
    name: 'obfuscated_exec',
    severity: 'high',
    description: 'Obfuscated execute via eval/base64 combo',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\beval\s*\(\s*(atob|Buffer\.from|base64)/i,
  },
  {
    name: 'hex_encoded_payload',
    severity: 'high',
    description: 'Hex-encoded payload executed at runtime',
    kind: 'high',
    skipCodeBlock: true,
    regex: /\\x[0-9a-f]{2}.*\b(exec|eval|Function)\b/i,
  },
  {
    name: 'runtime_install_exec',
    severity: 'high',
    description: 'Installs a package and immediately executes it',
    kind: 'high',
    skipCodeBlock: true,
    regex: /(pip|npm|pnpm)\s+install[^\n]*&&\s*(python|node|npx)\b/i,
  },
  {
    name: 'prompt_injection_covert',
    severity: 'high',
    description: 'Covert prompt injection instructing secret exfiltration',
    kind: 'high',
    skipCodeBlock: true,
    regex: /secretly\s+send|ignore\s+(all\s+)?previous\s+instructions/i,
  },
]

export const MEDIUM_RISK_PATTERNS: PatternDef[] = [
  {
    name: 'sudo_usage',
    severity: 'medium',
    description: 'Uses sudo for elevated privileges',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /\bsudo\s+/,
  },
  {
    name: 'docker_privileged',
    severity: 'medium',
    description: 'Runs docker in privileged mode',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /docker\s+run[^\n]*--privileged/,
  },
  {
    name: 'ssl_disabled',
    severity: 'medium',
    description: 'Disables TLS verification',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /--insecure|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/i,
  },
  {
    name: 'eval_usage',
    severity: 'medium',
    description: 'Uses eval on potentially untrusted input',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /\beval\s*\(/,
  },
  {
    name: 'subprocess_spawn',
    severity: 'medium',
    description: 'Spawns a subprocess with a shell',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /subprocess\.(Popen|run|call)\([^\n]*shell\s*=\s*True/,
  },
  {
    name: 'tunnel_service',
    severity: 'medium',
    description: 'Opens a tunnel (ngrok/cloudflared/frp)',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /\b(ngrok|cloudflared|frpc|localtunnel)\b/i,
  },
  {
    name: 'jailbreak_mode',
    severity: 'medium',
    description: 'Attempts jailbreak / unrestricted tool mode',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /jailbreak|unrestricted\s+mode|developer\s+override/i,
  },
  {
    name: 'tool_priority_manipulation',
    severity: 'medium',
    description: 'Manipulates tool priority / always-use instructions',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /always\s+use\s+this\s+tool|must\s+call\s+tool/i,
  },
  {
    name: 'credential_in_chat',
    severity: 'medium',
    description: 'Asks user to paste credentials into chat',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /paste\s+(your\s+)?(api\s+)?(key|token|secret)/i,
  },
  {
    name: 'shortener_download',
    severity: 'medium',
    description: 'Downloads from a URL shortener',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /https?:\/\/(bit\.ly|t\.co|tinyurl\.com|ow\.ly)\//i,
  },
  {
    name: 'paste_host_download',
    severity: 'medium',
    description: 'Downloads from an anonymous paste host',
    kind: 'medium',
    skipCodeBlock: true,
    regex: /https?:\/\/(transfer\.sh|pastebin\.com|ghostbin\.com)\//i,
  },
]

export const PIPE_TO_SHELL_PATTERNS: PatternDef[] = [
  {
    name: 'curl_pipe_shell',
    severity: 'high',
    description: 'Downloads and executes a remote script via curl|sh',
    kind: 'pipe',
    skipCodeBlock: true,
    regex: /curl\s+[^\n]*\|\s*(ba)?sh\b/i,
  },
  {
    name: 'wget_pipe_shell',
    severity: 'high',
    description: 'Downloads and executes a remote script via wget|sh',
    kind: 'pipe',
    skipCodeBlock: true,
    regex: /wget\s+[^\n]*\|\s*(ba)?sh\b/i,
  },
  {
    name: 'irm_iex',
    severity: 'high',
    description: 'PowerShell irm | iex download-and-execute',
    kind: 'pipe',
    skipCodeBlock: true,
    regex: /irm\s+[^\n]*\|\s*iex/i,
  },
]

export const SECRET_PATTERNS: PatternDef[] = [
  {
    name: 'leaked_secret',
    severity: 'high',
    description: 'Looks like a real leaked secret',
    kind: 'secret',
    regex: /\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9\-_]{20,}|sk-[A-Za-z0-9]{20,})\b/,
  },
]

export const TRUSTED_INSTALL_HOSTS = [
  'astral.sh',
  'sh.rustup.rs',
  'claude.ai',
  'cursor.com',
  'github.com',
  'raw.githubusercontent.com',
]

export const TIER1_ORGS = ['anthropics', 'anthropic', 'openai', 'google', 'microsoft', 'github', 'modelcontextprotocol']
export const TIER2_ORGS = ['slowmist', 'trailofbits', 'openzeppelin', 'snyk']

export const PLACEHOLDER_SECRET_RE = /(xxxx|example|your[-_]?key|changeme|placeholder|dummy)/i
