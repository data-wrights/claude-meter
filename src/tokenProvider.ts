import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { TokenResult, TokenType, ExtensionError } from "./types";

export function detectTokenType(token: string): TokenType {
  if (token.startsWith("sk-ant-admin-")) { return "admin-key"; }
  if (token.startsWith("sk-ant-"))       { return "api-key"; }
  return "oauth";
}

interface CredentialsFileShape {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
  organizationUuid?: string;
}

function getCredentialsFilePaths(): string[] {
  const home = os.homedir();
  const candidates: string[] = [
    // Claude Code standard path (confirmed on Windows)
    path.join(home, ".claude", ".credentials.json"),
  ];

  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, "Claude", ".credentials.json"),
      path.join(process.env.APPDATA, "claude", ".credentials.json")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        ".credentials.json"
      )
    );
  } else if (process.platform === "linux") {
    candidates.push(
      path.join(home, ".config", "claude", ".credentials.json")
    );
  }

  return candidates;
}

function tryReadCredentialsFile(filePath: string): TokenResult | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data: CredentialsFileShape = JSON.parse(raw) as CredentialsFileShape;
    const oauth = data.claudeAiOauth;
    if (!oauth?.accessToken) {
      return null;
    }
    return {
      token: oauth.accessToken,
      source: "auto-claude-code",
      tokenType: detectTokenType(oauth.accessToken),
      expiresAt: oauth.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function resolveToken(
  manualToken: string
): Promise<TokenResult | ExtensionError> {
  // 1. Manual override takes highest priority
  if (manualToken && manualToken.trim().length > 0) {
    const token = manualToken.trim();
    return { token, source: "manual-setting", tokenType: detectTokenType(token) };
  }

  // 2. Auto-detect from Claude Code credentials file
  for (const credPath of getCredentialsFilePaths()) {
    const result = tryReadCredentialsFile(credPath);
    if (result) {
      return result;
    }
  }

  // 3. No token found
  return {
    kind: "no-token",
    message:
      "Could not find a Claude OAuth token. " +
      "Set claudeMeter.manualToken in VS Code settings, " +
      "or ensure Claude Code is installed and authenticated.",
  };
}

export async function promptForManualToken(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Claude Meter: Enter Token",
    prompt:
      "Paste your Claude OAuth bearer token. " +
      "This will be saved to claudeMeter.manualToken in your VS Code settings.",
    password: true,
    placeHolder: "Bearer token from ~/.claude/.credentials.json",
    ignoreFocusOut: true,
  });
  if (value) {
    await vscode.workspace
      .getConfiguration("claudeMeter")
      .update("manualToken", value, vscode.ConfigurationTarget.Global);
  }
  return value;
}
