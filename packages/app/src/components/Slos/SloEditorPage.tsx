import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useForm, useFormState, useWatch } from 'react-hook-form';
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
import { useSaveSlo, useSlosEnabledGuard } from '@/slo';
import { useSource } from '@/source';
import { getApiErrorMessage } from '@/utils/apiErrors';

import { SloIndicatorFields } from './SloDefinitionFields';
import {
  DEFAULT_SLO_FORM_VALUES,
  sloFormResolver,
  type SloFormValues,
  toSloInput,
} from './sloForm';
import { SloFormSection } from './SloFormLayout';

function SloEditorPage() {
  const enabled = useSlosEnabledGuard();
  const router = useRouter();
  const title = usePageTitle('New SLO');

  const { control, handleSubmit, setValue, getValues } = useForm<SloFormValues>(
    {
      defaultValues: DEFAULT_SLO_FORM_VALUES,
      resolver: sloFormResolver,
    },
  );
  const { errors } = useFormState({ control, name: 'name' });
  const sourceId = useWatch({ control, name: 'source' });
  const { data: source } = useSource({ id: sourceId || undefined });

  const save = useSaveSlo();
  const onSave = handleSubmit(async values => {
    try {
      const saved = await save.mutateAsync({
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
            <Button component={Link} href="/slos" variant="secondary">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              loading={save.isPending}
              data-testid="slo-save"
            >
              Create SLO
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
            </Stack>
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
