import { Fragment, useState } from 'react';
import Link from 'next/link';
import { CloseButton, Select, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import {
  matchSettingsPage,
  SETTINGS_GROUPS,
  SettingsPage,
  SettingsPageId,
} from './settingsPages';

import styles from './TeamSettings.module.scss';

function settingsPageHref(id: SettingsPageId, anchor?: string) {
  return { pathname: '/team', query: { tab: id }, hash: anchor };
}

// Leave cmd/ctrl/shift-click to the browser so they still open a new tab.
const isPlainClick = (e: React.MouseEvent) =>
  !(e.metaKey || e.ctrlKey || e.shiftKey);

export default function TeamSettingsNav({
  pages,
  activeId,
  onSelect,
}: {
  pages: SettingsPage[];
  activeId: SettingsPageId;
  onSelect: (id: SettingsPageId, anchor?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = pages
    .map(page => ({ page, ...matchSettingsPage(page, query) }))
    .filter(match => match.visible);

  return (
    <>
      <Select
        className={styles.navSelect}
        aria-label="Team settings page"
        searchable
        allowDeselect={false}
        value={activeId}
        data={SETTINGS_GROUPS.map(group => ({
          group,
          items: pages
            .filter(page => page.group === group)
            .map(page => ({ value: page.id, label: page.label })),
        })).filter(group => group.items.length > 0)}
        onChange={value => value && onSelect(value as SettingsPageId)}
      />
      <nav aria-label="Team settings" className={styles.nav}>
        <TextInput
          size="xs"
          placeholder="Search settings"
          aria-label="Search settings"
          data-testid="team-settings-search"
          leftSection={<IconSearch size={14} />}
          rightSection={
            query ? (
              <CloseButton
                size="xs"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              />
            ) : null
          }
          value={query}
          onChange={e => setQuery(e.currentTarget.value)}
          onKeyDown={e => {
            // Prefer a page whose own name matched over one that only holds a matching setting.
            const best = matches.find(m => m.pageMatch) ?? matches[0];
            if (e.key === 'Enter' && query.trim() && best) {
              onSelect(
                best.page.id,
                best.pageMatch ? undefined : best.items[0]?.anchor,
              );
            } else if (e.key === 'Escape') {
              setQuery('');
            }
          }}
        />
        {matches.length === 0 && (
          <p className={styles.navEmpty}>
            No settings match &quot;{query.trim()}&quot;
          </p>
        )}
        {SETTINGS_GROUPS.map(group => {
          const groupMatches = matches.filter(m => m.page.group === group);
          if (groupMatches.length === 0) return null;
          return (
            <div key={group} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>{group}</div>
              {groupMatches.map(({ page, items }) => (
                <Fragment key={page.id}>
                  <Link
                    href={settingsPageHref(page.id)}
                    shallow
                    scroll={false}
                    className={styles.navItem}
                    data-active={page.id === activeId || undefined}
                    aria-current={page.id === activeId ? 'page' : undefined}
                    onClick={e => {
                      if (!isPlainClick(e)) return;
                      e.preventDefault();
                      onSelect(page.id);
                    }}
                  >
                    <span className={styles.navItemIcon}>{page.icon}</span>
                    <span className={styles.navItemLabel}>{page.label}</span>
                  </Link>
                  {items.map(item => (
                    <Link
                      key={item.anchor}
                      href={settingsPageHref(page.id, item.anchor)}
                      shallow
                      scroll={false}
                      className={styles.navSubItem}
                      onClick={e => {
                        if (!isPlainClick(e)) return;
                        e.preventDefault();
                        onSelect(page.id, item.anchor);
                      }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </Fragment>
              ))}
            </div>
          );
        })}
      </nav>
    </>
  );
}
