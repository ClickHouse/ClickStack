import {
  matchSettingsPage,
  resolveSettingsPage,
  SETTINGS_PAGES,
} from '../settingsPages';

const withoutPolicies = SETTINGS_PAGES.filter(p => !p.requiresAuthPolicy);

describe('resolveSettingsPage', () => {
  it('uses a current tab value and keeps the hash', () => {
    expect(resolveSettingsPage(SETTINGS_PAGES, 'webhooks', '')).toEqual({
      id: 'webhooks',
      legacyAnchor: false,
    });
  });

  it.each([
    ['data', 'sources'],
    ['team', 'members'],
    ['api-agents', 'api-keys'],
    ['integrations', 'webhooks'],
    ['advanced', 'query-settings'],
  ])('maps the old %s tab to %s', (tab, id) => {
    expect(resolveSettingsPage(SETTINGS_PAGES, tab, '')).toEqual({
      id,
      legacyAnchor: false,
    });
  });

  it.each([
    ['team-data-sources', 'sources'],
    ['team-data-connections', 'connections'],
    ['team-members', 'members'],
    ['team-api-agents-api-keys', 'api-keys'],
    ['team-api-agents-org-api-keys', 'api-keys'],
    ['team-api-agents-mcp-server', 'mcp'],
    ['team-integrations-webhooks', 'webhooks'],
    ['team-advanced-query-settings', 'query-settings'],
  ])('maps the old #%s anchor to %s and drops it', (hash, id) => {
    expect(resolveSettingsPage(SETTINGS_PAGES, 'data', hash)).toEqual({
      id,
      legacyAnchor: true,
    });
  });

  it('ignores an old anchor whose page is hidden', () => {
    expect(
      resolveSettingsPage(
        withoutPolicies,
        'access',
        'team-access-security-policies',
      ),
    ).toEqual({ id: 'sources', legacyAnchor: false });
  });

  it('maps an old tab value and keeps page-owned anchors', () => {
    expect(resolveSettingsPage(SETTINGS_PAGES, 'data', 'source-abc')).toEqual({
      id: 'sources',
      legacyAnchor: false,
    });
  });

  it('falls back to the first page for unknown or hidden pages', () => {
    expect(resolveSettingsPage(withoutPolicies, 'access', '').id).toBe(
      'sources',
    );
    expect(resolveSettingsPage(SETTINGS_PAGES, 'nope', '').id).toBe('sources');
  });
});

describe('matchSettingsPage', () => {
  const page = (id: string) => SETTINGS_PAGES.find(p => p.id === id)!;

  it('matches page label, keywords, and group case-insensitively', () => {
    expect(matchSettingsPage(page('mcp'), 'AI').visible).toBe(true);
    expect(matchSettingsPage(page('mcp'), 'claude').visible).toBe(true);
    expect(matchSettingsPage(page('mcp'), 'developer').visible).toBe(true);
    expect(matchSettingsPage(page('mcp'), 'webhook').visible).toBe(false);
  });

  it('finds a setting inside a page by its label', () => {
    const result = matchSettingsPage(page('query-settings'), 'Parallelize');
    expect(result.visible).toBe(true);
    expect(result.items.map(item => item.anchor)).toEqual([
      'setting-parallelizeWhenPossible',
    ]);
  });

  it('shows every page and no settings for an empty query', () => {
    expect(matchSettingsPage(page('query-settings'), '  ')).toEqual({
      visible: true,
      pageMatch: true,
      items: [],
    });
  });
});
