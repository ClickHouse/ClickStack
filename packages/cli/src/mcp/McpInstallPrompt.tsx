import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import Choice from '@/mcp/Choice';
import {
  type KeyIdentity,
  listTeams,
  type McpClient,
  type McpTeam,
  mcpUrl,
  verifyKey,
} from '@/mcp/install';
import { isValidUrl } from '@/utils/url';

export interface InstallResult {
  client: McpClient;
  error?: string;
}

type Step = 'appUrl' | 'key' | 'checking' | 'team' | 'agents' | 'confirm';

/**
 * Collects the app URL and API key, checks the key, offers a team and agent
 * choice when there is more than one, then asks before writing any config.
 * Calls `onDone` with the results, or with null if the user cancels.
 */
export default function McpInstallPrompt({
  initialAppUrl,
  name,
  clients,
  onDone,
}: {
  initialAppUrl?: string;
  name: string;
  clients: McpClient[];
  onDone: (results: InstallResult[] | null) => void;
}) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>(initialAppUrl ? 'key' : 'appUrl');
  const [appUrl, setAppUrl] = useState(initialAppUrl ?? '');
  const [key, setKey] = useState('');
  const [identity, setIdentity] = useState<KeyIdentity | null>(null);
  const [teams, setTeams] = useState<McpTeam[]>([]);
  const [team, setTeam] = useState<McpTeam | null>(null);
  const [teamsFailed, setTeamsFailed] = useState(false);
  const [chosen, setChosen] = useState(clients);
  const [error, setError] = useState<string | null>(null);

  const finish = (results: InstallResult[] | null) => {
    exit();
    onDone(results);
  };

  useInput(
    (input, inkKey) => {
      if (inkKey.return || input.toLowerCase() === 'y') {
        const server = { name, url: mcpUrl(appUrl), key, teamId: team?.id };
        finish(
          chosen.map(client => {
            try {
              client.install(server);
              return { client };
            } catch (e) {
              return {
                client,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
      } else if (inkKey.escape || input.toLowerCase() === 'n') {
        finish(null);
      }
    },
    { isActive: step === 'confirm' },
  );

  const afterTeam: Step = clients.length > 1 ? 'agents' : 'confirm';

  const submitAppUrl = () => {
    const trimmed = appUrl.trim().replace(/\/+$/, '');
    if (!isValidUrl(trimmed)) {
      setError('Enter a valid http:// or https:// URL.');
      return;
    }
    setError(null);
    setAppUrl(trimmed);
    setStep('key');
  };

  const submitKey = async () => {
    // Keys never contain whitespace; a paste can bring a trailing newline.
    const cleaned = key.replace(/\s/g, '');
    if (!cleaned) return;
    setKey(cleaned);
    setError(null);
    setStep('checking');
    try {
      setIdentity(await verifyKey(appUrl, cleaned));
      // A failed listing must not block the install or look like one team.
      const found = await listTeams(appUrl, cleaned).catch(() => null);
      setTeamsFailed(found == null);
      setTeams(found ?? []);
      setStep(found && found.length > 1 ? 'team' : afterTeam);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setKey('');
      setStep('key');
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        ClickStack MCP server install
      </Text>
      {step !== 'appUrl' && <Text dimColor>Server: {appUrl}</Text>}
      <Text> </Text>
      {error && <Text color="red">{error}</Text>}

      {step === 'appUrl' && (
        <Box>
          <Text>ClickStack URL: </Text>
          <TextInput
            value={appUrl}
            onChange={setAppUrl}
            onSubmit={submitAppUrl}
            placeholder="http://localhost:8080"
          />
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text dimColor>
            Paste a personal access key or an organization API key from Team
            Settings &gt; API &amp; Agents.
          </Text>
          <Box>
            <Text>API key: </Text>
            <TextInput
              value={key}
              onChange={setKey}
              onSubmit={submitKey}
              mask="*"
            />
          </Box>
        </Box>
      )}

      {step === 'checking' && (
        <Text>
          <Spinner type="dots" /> Checking the key…
        </Text>
      )}

      {teamsFailed && step !== 'key' && (
        <Text color="yellow">
          Could not list teams. The server will use the key&apos;s default team.
        </Text>
      )}

      {step === 'team' && (
        <Choice
          title="Team this server queries:"
          items={teams}
          label={t => (t.isCurrent ? `${t.name} (default)` : t.name)}
          initial={Math.max(
            0,
            teams.findIndex(t => t.isCurrent),
          )}
          onSubmit={([picked]) => {
            setTeam(picked);
            setStep(afterTeam);
          }}
          onCancel={() => finish(null)}
        />
      )}

      {step === 'agents' && (
        <Choice
          multi
          title="Agents to set up:"
          items={clients}
          label={c => c.label}
          onSubmit={picked => {
            setChosen(picked);
            setStep('confirm');
          }}
          onCancel={() => finish(null)}
        />
      )}

      {step === 'confirm' && identity && (
        <Box flexDirection="column">
          <Text color="green">
            Key works for{' '}
            {identity.isServiceAccount
              ? `organization key "${identity.name}"`
              : identity.name}
            .
          </Text>
          <Text> </Text>
          <Text>
            Add the ClickStack MCP server as "{name}"
            {team && ` for team ${team.name}`} to:
          </Text>
          {chosen.map(c => (
            <Text key={c.id}> - {c.label}</Text>
          ))}
          <Text> </Text>
          <Text dimColor>Enter or y to continue, Esc or n to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
