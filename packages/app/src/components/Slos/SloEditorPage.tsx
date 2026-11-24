import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useQueryStates } from 'nuqs';
import {
  type FieldPath,
  useForm,
  useFormState,
  useWatch,
} from 'react-hook-form';
import type { Filter } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Container,
  Flex,
  Grid,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { usePageTitle } from '@/brand';
import { InlineNameInputControlled } from '@/components/InlineNameInput/InlineNameInput';
import { PageHeader } from '@/components/PageHeader';
import { withAppNavForSurface } from '@/layout';
import { useSaveSlo, useSlo, useSlosEnabledGuard } from '@/slo';
import { useSource } from '@/source';
import { getApiErrorMessage } from '@/utils/apiErrors';
import { parseAsJsonEncoded, parseAsStringEncoded } from '@/utils/queryParsers';

import {
  SloDetailsFields,
  SloIndicatorFields,
  SloObjectiveFields,
} from './SloDefinitionFields';
import {
  buildSloPreviewRequest,
  DEFAULT_SLO_FORM_VALUES,
  getSloPreviewKey,
  sloCopyFormValues,
  sloFormResolver,
  type SloFormValues,
  sloFormValuesFromSearch,
  type SloPreviewRequest,
  sloToFormValues,
  toSloInput,
} from './sloForm';
import { SloFormSection } from './SloFormLayout';
import { SloPreviewPanel } from './SloPreviewPanel';

/** The fields a preview needs, validated before it runs. */
const PREVIEW_FIELDS: FieldPath<SloFormValues>[] = [
  'source',
  'indicator',
  'target',
  'window',
];

// Carried over from Search by "Create SLO from this search".
const prefillParsers = {
  source: parseAsStringEncoded,
  where: parseAsStringEncoded,
  whereLanguage: parseAsStringEncoded,
  filters: parseAsJsonEncoded<Filter[]>(),
  name: parseAsStringEncoded,
};

function SloEditorPage() {
  const enabled = useSlosEnabledGuard();
  const router = useRouter();
  const editId =
    typeof router.query.sloId === 'string' ? router.query.sloId : undefined;
  // "Duplicate" on an SLO links here with ?duplicate=<id>.
  const duplicateId =
    !editId && typeof router.query.duplicate === 'string'
      ? router.query.duplicate
      : undefined;
  const [prefill] = useQueryStates(prefillParsers);
  const { data: existing } = useSlo(editId);
  const { data: original } = useSlo(duplicateId);
  const title = usePageTitle(editId ? 'Edit SLO' : 'New SLO');

  const { control, handleSubmit, reset, setValue, getValues, trigger } =
    useForm<SloFormValues>({
      defaultValues: DEFAULT_SLO_FORM_VALUES,
      resolver: sloFormResolver,
    });
  const { errors } = useFormState({ control, name: 'name' });
  const [sourceId, indicator, target, sloWindow] = useWatch({
    control,
    name: ['source', 'indicator', 'target', 'window'],
  });
  const { data: source } = useSource({ id: sourceId || undefined });

  // Load the SLO being edited or copied, or the search it starts from, once.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !router.isReady) return;
    if (editId) {
      if (!existing) return;
      reset(sloToFormValues(existing));
    } else if (duplicateId) {
      if (!original) return;
      reset(sloCopyFormValues(original));
    } else if (prefill.source) {
      reset(sloFormValuesFromSearch({ ...prefill, source: prefill.source }));
    }
    initializedRef.current = true;
  }, [router.isReady, editId, existing, duplicateId, original, prefill, reset]);

  const [preview, setPreview] = useState<SloPreviewRequest | null>(null);
  const runPreview = async () => {
    if (!source || !(await trigger(PREVIEW_FIELDS))) return;
    setPreview(buildSloPreviewRequest(getValues(), source, Date.now()) ?? null);
  };
  const isPreviewStale =
    preview != null &&
    getSloPreviewKey(
      { source: sourceId, indicator, window: sloWindow },
      source,
    ) !== preview.key;

  // A definition carried over from Search previews itself once its source
  // has loaded.
  const autoPreviewedRef = useRef(false);
  useEffect(() => {
    if (autoPreviewedRef.current || !initializedRef.current || !source) return;
    if (editId || !prefill.source) return;
    autoPreviewedRef.current = true;
    void trigger(PREVIEW_FIELDS).then(valid => {
      if (!valid) return;
      setPreview(
        buildSloPreviewRequest(getValues(), source, Date.now()) ?? null,
      );
    });
  });

  const save = useSaveSlo();
  const onSave = handleSubmit(async values => {
    try {
      const saved = await save.mutateAsync({
        id: editId,
        slo: toSloInput(values, source),
      });
      notifications.show({ color: 'green', message: `Saved ${saved.name}` });
      router.push('/slos');
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Could not save the SLO',
        message: await getApiErrorMessage(e, 'Something went wrong'),
      });
    }
  });

  if (!enabled) return null;

  return (
    <div data-testid="slo-editor-page">
      <Head>
        <title>{title}</title>
      </Head>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs fz="sm">
            <Anchor component={Link} href="/slos" fz="sm" c="dimmed">
              SLOs
            </Anchor>
            {editId && existing && (
              <Anchor
                component={Link}
                href={`/slos/${editId}`}
                fz="sm"
                c="dimmed"
              >
                {existing.name}
              </Anchor>
            )}
          </Breadcrumbs>
        }
      >
        {/* The page title, like a dashboard's or a saved search's name. */}
        <Flex justify="space-between" align="flex-start" gap="sm">
          {/* Takes the free width, which the name grows into. */}
          <Box flex={1} miw={0}>
            <InlineNameInputControlled
              control={control}
              name="name"
              size="md"
              headingLevel={3}
              placeholder="Untitled SLO"
              aria-label="SLO name"
              data-testid="slo-name-input"
            />
            {errors.name?.message && (
              <Text size="xs" variant="danger" data-testid="slo-name-error">
                {errors.name.message}
              </Text>
            )}
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Button
              component={Link}
              href={editId ? `/slos/${editId}` : '/slos'}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              loading={save.isPending}
              data-testid="slo-save"
            >
              {editId ? 'Save SLO' : 'Create SLO'}
            </Button>
          </Group>
        </Flex>
      </PageHeader>
      {/* Keeps the form's controls under the sticky header when scrolled. */}
      <Container size="xl" py="md" style={{ isolation: 'isolate' }}>
        <Grid>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap="md">
              <SloFormSection
                title="Indicator"
                description="Which events count, and which of them are good. Good divided by eligible is the SLI."
              >
                <SloIndicatorFields
                  control={control}
                  getValues={getValues}
                  setValue={setValue}
                  source={source}
                />
              </SloFormSection>
              <SloFormSection title="Objective">
                <SloObjectiveFields control={control} setValue={setValue} />
              </SloFormSection>
              <SloFormSection title="Details">
                <SloDetailsFields control={control} />
              </SloFormSection>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <SloPreviewPanel
              request={preview}
              isStale={isPreviewStale}
              target={target}
              onRun={runPreview}
            />
          </Grid.Col>
        </Grid>
      </Container>
    </div>
  );
}

// Client only, like Search and the chart explorer: the SQL editors and the
// themed charts render differently on the server.
const SloEditorPageDynamic = dynamic(async () => SloEditorPage, { ssr: false });

// @ts-expect-error next/dynamic component type does not include the getLayout static
SloEditorPageDynamic.getLayout = withAppNavForSurface('slo');

export default SloEditorPageDynamic;
