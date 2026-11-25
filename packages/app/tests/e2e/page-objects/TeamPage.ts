/**
 * TeamPage - Page object for the /team settings page
 * Each setting has its own page, picked from the sidebar nav.
 */
import { Locator, Page } from '@playwright/test';

export class TeamPage {
  readonly page: Page;

  private readonly pageContainer: Locator;
  private readonly settingsNav: Locator;
  private readonly settingsSearch: Locator;
  private readonly pageTitle: Locator;

  // Section containers
  private readonly sourcesSection: Locator;
  private readonly connectionsSection: Locator;
  private readonly integrationsSection: Locator;
  private readonly teamNameSection: Locator;
  private readonly apiKeysSection: Locator;
  private readonly mcpServerSection: Locator;
  private readonly teamMembersSection: Locator;
  private readonly securityPoliciesPage: Locator;
  private readonly querySettingsPage: Locator;

  // Team name elements
  private readonly teamNameDisplay: Locator;
  private readonly teamNameChangeButton: Locator;
  private readonly teamNameInput: Locator;
  private readonly teamNameSaveButton: Locator;
  private readonly teamNameCancelButton: Locator;

  // API Keys elements
  // Both rotate flows go through the shared `useConfirm` dialog, so only the
  // triggers are per-key. Its locators are confirmDialog* below.
  private readonly rotateApiKeyButton: Locator;
  private readonly rotateAccessKeyButton: Locator;

  // Connections elements
  private readonly addConnectionButton: Locator;

  // Webhooks elements
  private readonly addWebhookButton: Locator;
  private readonly webhooksEmptyState: Locator;

  // Team members elements
  private readonly inviteMemberButton: Locator;
  private readonly inviteEmailInput: Locator;
  private readonly sendInviteButton: Locator;
  private readonly confirmDeleteMemberButton: Locator;
  private readonly cancelDeleteMemberButton: Locator;
  private readonly confirmDialogConfirmBtn: Locator;
  private readonly confirmDialogCancelBtn: Locator;
  private readonly confirmDialogModal: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageContainer = page.getByTestId('team-page');
    this.settingsNav = page.getByRole('navigation', { name: 'Team settings' });
    this.settingsSearch = page.getByTestId('team-settings-search');
    this.pageTitle = page.locator('#team-settings-page-title');

    this.sourcesSection = page.getByTestId('sources-section');
    this.connectionsSection = page.getByTestId('connections-section');
    this.integrationsSection = page.getByTestId('integrations-section');
    this.teamNameSection = page.getByTestId('team-name-section');
    this.apiKeysSection = page.getByTestId('api-keys-section');
    this.mcpServerSection = page.getByTestId('mcp-server-section');
    this.teamMembersSection = page.getByTestId('team-members-section');
    this.securityPoliciesPage = page.getByTestId(
      'team-settings-page-security-policies',
    );
    this.querySettingsPage = page.getByTestId(
      'team-settings-page-query-settings',
    );

    this.teamNameDisplay = page.getByTestId('team-name-display');
    this.teamNameChangeButton = page.getByTestId('team-name-change-button');
    this.teamNameInput = page.getByTestId('team-name-input');
    this.teamNameSaveButton = page.getByTestId('team-name-save-button');
    this.teamNameCancelButton = page.getByTestId('team-name-cancel-button');

    this.rotateApiKeyButton = page.getByTestId('rotate-api-key-button');
    this.rotateAccessKeyButton = page.getByTestId('rotate-access-key-button');

    this.addConnectionButton = page.getByTestId('add-connection-button');

    this.addWebhookButton = page.getByTestId('add-webhook-section-button');
    this.webhooksEmptyState = page.getByTestId('webhooks-empty-state');

    this.inviteMemberButton = page.getByTestId('invite-member-button');
    this.inviteEmailInput = page.getByTestId('invite-email-input');
    this.sendInviteButton = page.getByTestId('send-invite-button');
    this.confirmDeleteMemberButton = page.getByTestId('confirm-delete-member');
    this.cancelDeleteMemberButton = page.getByTestId('cancel-delete-member');
    this.confirmDialogConfirmBtn = page.getByTestId('confirm-confirm-button');
    this.confirmDialogCancelBtn = page.getByTestId('confirm-cancel-button');
    this.confirmDialogModal = page.getByTestId('confirm-modal');
  }

  async goto() {
    await this.page.goto('/team');
    await this.pageContainer.waitFor({ state: 'visible', timeout: 10000 });
  }

  navLink(label: string) {
    return this.settingsNav.getByRole('link', { name: label, exact: true });
  }

  private async openPage(label: string, content: Locator) {
    await this.navLink(label).click();
    await content.waitFor({ state: 'visible' });
  }

  async openSourcesPage() {
    await this.openPage('Sources', this.sourcesSection);
  }

  async openConnectionsPage() {
    await this.openPage('Connections', this.connectionsSection);
  }

  async openMembersPage() {
    await this.openPage('Members', this.teamMembersSection);
  }

  async openSecurityPoliciesPage() {
    await this.openPage('Security policies', this.securityPoliciesPage);
  }

  async openApiKeysPage() {
    await this.openPage('API keys', this.apiKeysSection);
  }

  async openAiAgentsPage() {
    await this.openPage('AI agents', this.mcpServerSection);
  }

  async openWebhooksPage() {
    await this.openPage('Webhooks', this.integrationsSection);
  }

  async openQuerySettingsPage() {
    await this.openPage('Query settings', this.querySettingsPage);
  }

  async searchSettings(query: string) {
    await this.settingsSearch.fill(query);
  }

  // --- Team Name ---

  async getTeamNameText() {
    return this.teamNameDisplay.textContent();
  }

  async startEditingTeamName() {
    await this.teamNameChangeButton.click();
    await this.teamNameInput.waitFor({ state: 'visible' });
  }

  async fillTeamName(name: string) {
    await this.teamNameInput.clear();
    await this.teamNameInput.fill(name);
  }

  async saveTeamName() {
    await this.teamNameSaveButton.click();
  }

  async cancelEditingTeamName() {
    await this.teamNameCancelButton.click();
  }

  async changeTeamName(name: string) {
    await this.startEditingTeamName();
    await this.fillTeamName(name);
    await this.saveTeamName();
  }

  // --- API Keys ---

  async clickRotateApiKey() {
    await this.rotateApiKeyButton.click();
  }

  async clickRotateAccessKey() {
    await this.rotateAccessKeyButton.click();
  }

  // Confirming rotates the shared E2E account's keys. For the personal key that
  // 401s the bearer requests in dashboard-external-api-*.spec.ts running in
  // parallel workers, so the rotate specs only cancel. See the note in
  // team.spec.ts; the confirm path is covered by me.int.test.ts.
  async cancelConfirmDialog() {
    await this.confirmDialogCancelBtn.click();
  }

  // --- Connections ---

  async clickAddConnection() {
    await this.addConnectionButton.click();
  }

  async fillConnectionForm(opts: {
    name: string;
    host: string;
    username: string;
    password: string;
  }) {
    await this.page.getByTestId('connection-name-input').clear();
    await this.page.getByTestId('connection-name-input').fill(opts.name);
    await this.page.getByTestId('connection-host-input').clear();
    await this.page.getByTestId('connection-host-input').fill(opts.host);
    await this.page.getByTestId('connection-username-input').clear();
    await this.page
      .getByTestId('connection-username-input')
      .fill(opts.username);
    await this.page.getByTestId('update-password-button').click();
    await this.page
      .getByTestId('connection-password-input')
      .fill(opts.password);
  }

  async saveConnection() {
    await this.page.getByTestId('connection-save-button').click();
  }

  // --- Webhooks ---

  async clickAddWebhook() {
    await this.addWebhookButton.click();
  }

  async fillWebhookForm(opts: {
    serviceType: 'Slack' | 'incident.io' | 'Generic';
    name: string;
    url: string;
  }) {
    await this.page
      .getByTestId('service-type-radio-group')
      .getByRole('radio', { name: opts.serviceType, exact: true })
      .click();
    await this.page.getByTestId('webhook-name-input').fill(opts.name);
    await this.page.getByTestId('webhook-url-input').fill(opts.url);
  }

  async submitWebhookForm() {
    await this.page.getByTestId('add-webhook-button').click();
  }

  async createWebhook(opts: {
    serviceType: 'Slack' | 'incident.io' | 'Generic';
    name: string;
    url: string;
  }) {
    await this.clickAddWebhook();
    await this.fillWebhookForm(opts);
    await this.submitWebhookForm();
  }

  // --- Team Members ---

  async clickInviteMember() {
    await this.inviteMemberButton.click();
  }

  async fillInviteEmail(email: string) {
    await this.inviteEmailInput.fill(email);
  }

  async submitInvite() {
    await this.sendInviteButton.click();
  }

  async inviteTeamMember(email: string) {
    await this.clickInviteMember();
    await this.fillInviteEmail(email);
    await this.submitInvite();
  }

  async confirmDeleteMember() {
    await this.confirmDeleteMemberButton.click();
  }

  async cancelDeleteMember() {
    await this.cancelDeleteMemberButton.click();
  }

  getInvitationRow(email: string) {
    return this.teamMembersSection.locator('tr').filter({ hasText: email });
  }

  async deleteInvitationByEmail(email: string) {
    await this.getInvitationRow(email)
      .getByRole('button', { name: 'Delete' })
      .click();
  }

  async editWebhookByName(webhookName: string) {
    const webhookItem = this.integrationsSection
      .locator('div')
      .filter({ hasText: webhookName })
      .filter({ has: this.page.getByRole('button', { name: 'Edit' }) })
      .last();
    await webhookItem.getByRole('button', { name: 'Edit' }).click();
  }

  async deleteWebhookByName(webhookName: string) {
    const webhookItem = this.integrationsSection
      .locator('div')
      .filter({ hasText: webhookName })
      .filter({ has: this.page.getByRole('button', { name: 'Delete' }) })
      .last();
    await webhookItem.getByRole('button', { name: 'Delete' }).click();
  }

  async confirmDialog() {
    await this.confirmDialogConfirmBtn.click();
  }

  // --- Getters for assertions ---

  get container() {
    return this.pageContainer;
  }

  get nav() {
    return this.settingsNav;
  }

  get search() {
    return this.settingsSearch;
  }

  get title() {
    return this.pageTitle;
  }

  get sources() {
    return this.sourcesSection;
  }

  get connections() {
    return this.connectionsSection;
  }

  get integrations() {
    return this.integrationsSection;
  }

  get teamName() {
    return this.teamNameSection;
  }

  get teamNameValue() {
    return this.teamNameDisplay;
  }

  get teamNameEditButton() {
    return this.teamNameChangeButton;
  }

  get teamNameSave() {
    return this.teamNameSaveButton;
  }

  get teamNameCancel() {
    return this.teamNameCancelButton;
  }

  get apiKeys() {
    return this.apiKeysSection;
  }

  get mcpServer() {
    return this.mcpServerSection;
  }

  get rotateButton() {
    return this.rotateApiKeyButton;
  }

  get rotateAccessKeyTrigger() {
    return this.rotateAccessKeyButton;
  }

  /** Shared `useConfirm` dialog, used by both rotate flows. */
  get confirmDialogBox() {
    return this.confirmDialogModal;
  }

  get members() {
    return this.teamMembersSection;
  }

  get inviteButton() {
    return this.inviteMemberButton;
  }

  get webhooksEmpty() {
    return this.webhooksEmptyState;
  }

  get addWebhook() {
    return this.addWebhookButton;
  }

  get addConnection() {
    return this.addConnectionButton;
  }

  get securityPolicies() {
    return this.securityPoliciesPage;
  }

  get querySettings() {
    return this.querySettingsPage;
  }

  get connectionForm() {
    return this.page.getByTestId('connection-form');
  }

  get webhookNameInput() {
    return this.page.getByTestId('webhook-name-input');
  }

  get webhookUrlInput() {
    return this.page.getByTestId('webhook-url-input');
  }
}
