/**
 * eslint-plugin-react-hook-form still calls the ESLint 8 `context.getScope()`,
 * which neither ESLint 9 nor oxlint provides. `fixupPluginRules` adds it back.
 */
import { fixupPluginRules } from '@eslint/compat';
import reactHookForm from 'eslint-plugin-react-hook-form';

export default fixupPluginRules(reactHookForm);
