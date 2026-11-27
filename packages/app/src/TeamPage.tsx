import { ReactNode, useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { SubmitHandler, useForm } from 'react-hook-form';
import { Badge } from '@clickhouse/click-ui';
import {
  Anchor,
  Button,
  Center,
  Group,
  Loader,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconPencil } from '@tabler/icons-react';

import { PageHeader } from './components/PageHeader';
import ApiKeysSection from './components/TeamSettings/ApiKeysSection';
import ConnectionsSection from './components/TeamSettings/ConnectionsSection';
import IacMigrationSection from './components/TeamSettings/IacMigrationSection';
import IntegrationsSection from './components/TeamSettings/IntegrationsSection';
import McpServerSection from './components/TeamSettings/McpServerSection';
import OrgApiKeysSection from './components/TeamSettings/OrgApiKeysSection';
import SecurityPoliciesSection from './components/TeamSettings/SecurityPoliciesSection';
import {
  resolveSettingsPage,
  SETTINGS_PAGES,
  SettingsPageId,
} from './components/TeamSettings/settingsPages';
import SourcesSection from './components/TeamSettings/SourcesSection';
import TeamMembersSection from './components/TeamSettings/TeamMembersSection';
import TeamQueryConfigSection from './components/TeamSettings/TeamQueryConfigSection';
import TeamSettingsNav from './components/TeamSettings/TeamSettingsNav';
import { useScrollToSetting } from './components/TeamSettings/useScrollToSetting';
import api from './api';
import { usePageTitle } from './brand';
import { IS_LOCAL_MODE } from './config';
import { APP_CONTENT_SCROLL_CONTAINER_ID, withAppNav } from './layout';

import styles from './components/TeamSettings/TeamSettings.module.scss';

function renderSettingsPage(
  id: SettingsPageId,
  allowedAuthMethods: string[],
): ReactNode {
  switch (id) {
    case 'sources':
      return <SourcesSection />;
    case 'connections':
      return <ConnectionsSection />;
    case 'query-settings':
      return <TeamQueryConfigSection />;
    case 'members':
      return <TeamMembersSection />;
    case 'security-policies':
      return (
        <SecurityPoliciesSection allowedAuthMethods={allowedAuthMethods} />
      );
    case 'webhooks':
      return <IntegrationsSection />;
    case 'api-keys':
      return (
        <ApiKeysSection>
          {/* Org keys are stored by the API, which local mode doesn't run. */}
          {!IS_LOCAL_MODE && <OrgApiKeysSection />}
        </ApiKeysSection>
      );
    case 'mcp':
      return <McpServerSection />;
    case 'terraform':
      return <IacMigrationSection />;
  }
}

export default function TeamPage() {
  const title = usePageTitle('My Team');
  const router = useRouter();
  const { data: team, refetch: refetchTeam, isLoading } = api.useTeam();
  const setTeamName = api.useSetTeamName();
  const allowedAuthMethods = team?.allowedAuthMethods ?? [];
  const hasAllowedAuthMethods = allowedAuthMethods.length > 0;

  const hasAdminAccess = true;
  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const form = useForm<{ name: string }>({
    defaultValues: { name: team?.name },
  });

  const onSubmitTeamName: SubmitHandler<{ name: string }> = useCallback(
    async values => {
      setTeamName.mutate(
        { name: values.name },
        {
          onError: () => {
            notifications.show({
              color: 'red',
              message: 'Failed to update team name',
            });
          },
          onSuccess: () => {
            notifications.show({
              color: 'green',
              message: 'Updated team name',
            });
            refetchTeam();
            setIsEditingTeamName(false);
          },
        },
      );
    },
    [refetchTeam, setTeamName],
  );

  const pages = SETTINGS_PAGES.filter(
    page => !page.requiresAuthPolicy || hasAllowedAuthMethods,
  );
  const queryTab =
    typeof router.query.tab === 'string' ? router.query.tab : null;
  // asPath carries the hash on the client; the server render never sees it.
  const hash = router.asPath.split('#')[1] ?? '';
  const { id: activeId, legacyAnchor } = resolveSettingsPage(
    pages,
    queryTab,
    hash,
  );
  const activePage = pages.find(page => page.id === activeId);
  const [jumpNonce, setJumpNonce] = useState(0);
  // Start waiting for the field only once the team has loaded and the page renders.
  useScrollToSetting(
    team != null && activePage?.items?.some(item => item.anchor === hash)
      ? hash
      : null,
    jumpNonce,
  );

  // Rewrite old and missing `?tab=` values to the page being shown. Waits for
  // the team so a security policies link isn't redirected before it loads.
  useEffect(() => {
    if (!router.isReady || team == null) return;
    if (queryTab === activeId && !legacyAnchor) return;
    void router.replace(
      {
        pathname: router.pathname,
        query: { ...router.query, tab: activeId },
        // Keep anchors pages consume themselves, like SourcesList's `#source-<id>`.
        hash: legacyAnchor ? undefined : hash || undefined,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  }, [activeId, hash, legacyAnchor, queryTab, router, team]);

  const selectPage = (id: SettingsPageId, anchor?: string) => {
    if (anchor) {
      // A new hash re-runs the jump on its own; only a repeat pick needs the nonce.
      if (anchor === hash && id === activeId) setJumpNonce(n => n + 1);
    } else if (id === activeId) {
      return;
    } else {
      document
        .getElementById(APP_CONTENT_SCROLL_CONTAINER_ID)
        ?.scrollTo({ top: 0 });
    }
    void router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, tab: id },
        hash: anchor,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  return (
    <div className="TeamPage" data-testid="team-page">
      <Head>
        <title>{title}</title>
      </Head>
      <PageHeader>
        <div data-testid="team-name-section">
          {isEditingTeamName ? (
            <form onSubmit={form.handleSubmit(onSubmitTeamName)}>
              <Group gap="xs">
                <TextInput
                  data-testid="team-name-input"
                  size="xs"
                  placeholder="My Team"
                  required
                  error={form.formState.errors.name?.message}
                  {...form.register('name', { required: true })}
                  miw={300}
                  maxLength={100}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      setIsEditingTeamName(false);
                    }
                  }}
                />
                <Button
                  data-testid="team-name-save-button"
                  type="submit"
                  size="xs"
                  variant="primary"
                  loading={setTeamName.isPending}
                >
                  Save
                </Button>
                <Button
                  data-testid="team-name-cancel-button"
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={setTeamName.isPending}
                  onClick={() => setIsEditingTeamName(false)}
                >
                  Cancel
                </Button>
              </Group>
            </form>
          ) : (
            <Group gap="sm">
              <span data-testid="team-name-display">
                {team?.name || 'My team'}
              </span>
              {hasAdminAccess && (
                <Button
                  data-testid="team-name-change-button"
                  size="xs"
                  variant="subtle"
                  px={4}
                  aria-label="Edit team name"
                  onClick={() => {
                    form.reset({ name: team?.name });
                    setIsEditingTeamName(true);
                  }}
                >
                  <IconPencil size={16} />
                </Button>
              )}
            </Group>
          )}
        </div>
      </PageHeader>
      {isLoading && (
        <Center mt="xl">
          <Loader color="dimmed" />
        </Center>
      )}
      {!isLoading && team != null && activePage != null && (
        <div className={styles.layout}>
          <TeamSettingsNav
            pages={pages}
            activeId={activeId}
            onSelect={selectPage}
          />
          <main
            className={styles.content}
            aria-labelledby="team-settings-page-title"
            data-testid={`team-settings-page-${activeId}`}
          >
            <header className={styles.pageHeading}>
              <h2 id="team-settings-page-title" className={styles.pageTitle}>
                {activePage.label}
                {activePage.badge && (
                  <Badge size="sm" text={activePage.badge} state="info" />
                )}
              </h2>
              <p className={styles.pageDescription}>{activePage.description}</p>
              {activePage.links && (
                <Group gap="md" mt={4}>
                  {activePage.links.map(link => (
                    <Anchor
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="sm"
                    >
                      <Group gap={4} wrap="nowrap">
                        {link.label}
                        <IconExternalLink size={14} aria-hidden />
                      </Group>
                    </Anchor>
                  ))}
                </Group>
              )}
            </header>
            {renderSettingsPage(activeId, allowedAuthMethods)}
          </main>
        </div>
      )}
    </div>
  );
}

TeamPage.getLayout = withAppNav;
