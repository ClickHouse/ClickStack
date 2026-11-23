import React from 'react';
import { Control, useForm } from 'react-hook-form';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  InputControlled,
  PasswordInputControlled,
} from '@/components/InputControlled';

type TestFormValues = { testInput: string; testPassword: string };

function TestForm({
  children,
}: {
  children: (control: Control<TestFormValues>) => React.ReactElement;
}) {
  const { control } = useForm<TestFormValues>({
    defaultValues: {
      testInput: '',
      testPassword: '',
    },
  });

  return <form>{children(control)}</form>;
}

describe('InputControlled', () => {
  it('renders input with correct props', () => {
    renderWithMantine(
      <TestForm>
        {control => (
          <InputControlled
            name="testInput"
            placeholder="Test input"
            control={control}
          />
        )}
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Test input');
    expect(input).toBeInTheDocument();
  });

  it('handles input changes', async () => {
    renderWithMantine(
      <TestForm>
        {control => (
          <InputControlled
            name="testInput"
            placeholder="Test input"
            control={control}
          />
        )}
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Test input');
    fireEvent.change(input, { target: { value: 'test value' } });

    await waitFor(() => {
      expect(input).toHaveValue('test value');
    });
  });
});

describe('PasswordInputControlled', () => {
  it('renders password input with correct props', () => {
    renderWithMantine(
      <TestForm>
        {control => (
          <PasswordInputControlled
            name="testPassword"
            placeholder="Enter password"
            control={control}
          />
        )}
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('handles password input changes', async () => {
    renderWithMantine(
      <TestForm>
        {control => (
          <PasswordInputControlled
            name="testPassword"
            placeholder="Enter password"
            control={control}
          />
        )}
      </TestForm>,
    );

    const input = screen.getByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'testpassword123' } });

    await waitFor(() => {
      expect(input).toHaveValue('testpassword123');
    });
  });
});
