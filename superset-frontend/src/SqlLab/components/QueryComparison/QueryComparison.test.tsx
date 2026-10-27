/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { QueryState, testQueryResponse } from '@superset-ui/core';
import userEvent from '@testing-library/user-event';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from 'spec/helpers/testing-library';
import { cloneQueryToNewTab } from 'src/SqlLab/actions/sqlLab';
import { QueryTableProps } from 'src/SqlLab/components/QueryTable';
import QueryComparison from '.';
import { MAX_DIFF_CHARACTERS, MAX_DIFF_LINES } from './utils';

const mockDispatch = jest.fn();
jest.mock('src/SqlLab/hooks/useAppDispatch', () => ({
  useAppDispatch: () => mockDispatch,
}));
jest.mock('src/SqlLab/actions/sqlLab', () => ({
  cloneQueryToNewTab: jest.fn(() => ({ type: 'CLONE_TEST' })),
}));
jest.mock('src/SqlLab/components/QueryTable', () => ({
  __esModule: true,
  default: ({ queries = [], renderComparison }: QueryTableProps) => (
    <div>
      {queries.map(query => (
        <div key={query.id}>{renderComparison?.(query)}</div>
      ))}
    </div>
  ),
}));
jest.mock('react-diff-viewer-continued', () => ({
  __esModule: true,
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) => (
    <div data-test="sql-diff">
      <pre>{oldValue}</pre>
      <pre>{newValue}</pre>
    </div>
  ),
}));

const runs = ['a', 'b', 'c'].map((id, index) => ({
  ...testQueryResponse,
  id,
  sql: `SELECT ${index + 1}`,
  startDttm: 1000,
  endDttm: 1100 + index * 100,
}));

const select = (id: string) =>
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: `Select query run ${id} for comparison`,
    }),
  );
const compare = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Compare runs' }));

afterEach(() => jest.clearAllMocks());

test('makes comparison checkboxes reachable by keyboard', () => {
  render(<QueryComparison queries={runs} displayLimit={100} />);
  for (const id of ['a', 'b', 'c']) {
    userEvent.tab();
    expect(
      screen.getByRole('checkbox', {
        name: `Select query run ${id} for comparison`,
      }),
    ).toHaveFocus();
  }
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('requires two runs, prevents a third, and clears selection', () => {
  render(<QueryComparison queries={runs} displayLimit={100} />);
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeDisabled();
  select('a');
  expect(screen.getByText('Baseline A')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeDisabled();
  select('b');
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeEnabled();
  expect(
    screen.getByRole('checkbox', {
      name: 'Select query run c for comparison',
    }),
  ).toBeDisabled();
  select('b');
  expect(
    screen.getByRole('checkbox', {
      name: 'Select query run c for comparison',
    }),
  ).toBeEnabled();
  select('c');
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(
    screen.getByRole('checkbox', {
      name: 'Select query run a for comparison',
    }),
  ).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeDisabled();
});

test('compares SQL, swaps direction, and opens a tab without autorun', async () => {
  render(<QueryComparison queries={runs} displayLimit={100} />);
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(screen.getByTestId('sql-diff')).toHaveTextContent('SELECT 1SELECT 2');
  expect(screen.getByText(/Percentage change: 100\.00%/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Swap A/B' }));
  expect(screen.getByTestId('sql-diff')).toHaveTextContent('SELECT 2SELECT 1');
  expect(screen.getByText(/Percentage change: -50\.00%/)).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Open Baseline A in new tab' }),
  );
  expect(cloneQueryToNewTab).toHaveBeenCalledWith(runs[1], false);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});

test('preserves IDs through pagination and refresh, removes stale selections', async () => {
  const { rerender } = render(
    <QueryComparison queries={runs.slice(0, 2)} displayLimit={100} />,
  );
  select('a');
  select('b');
  rerender(<QueryComparison queries={[...runs]} displayLimit={100} />);
  expect(
    screen.getByRole('checkbox', {
      name: 'Select query run a for comparison',
    }),
  ).toBeChecked();
  compare();
  rerender(<QueryComparison queries={[runs[1], runs[2]]} displayLimit={100} />);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Compare runs' })).toBeDisabled();
});

test('editor-key remount resets selection', () => {
  const { rerender } = render(
    <QueryComparison key="editor-a" queries={runs} displayLimit={100} />,
  );
  select('a');
  rerender(
    <QueryComparison key="editor-b" queries={runs} displayLimit={100} />,
  );
  expect(
    screen.getByRole('button', { name: 'Clear selection' }),
  ).toBeDisabled();
});

test('shows identical SQL and unavailable metrics for incomplete runs', async () => {
  render(
    <QueryComparison
      queries={[
        { ...runs[0], sql: '', state: QueryState.Running },
        { ...runs[1], sql: '', state: QueryState.Failed, dbId: 2 },
      ]}
      displayLimit={100}
    />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByText('No SQL changes')).toBeVisible());
  expect(screen.getByText(/Percentage change: Not available/)).toBeVisible();
  expect(screen.getByText('These runs use different databases.')).toBeVisible();
  expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
});

test('compares executed SQL, swaps direction, and opens the original without autorun', async () => {
  const executedRuns = runs.map((run, index) => ({
    ...run,
    executedSql: `SELECT ${index + 10}`,
  }));
  render(<QueryComparison queries={executedRuns} displayLimit={100} />);
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  const toggle = screen.getByRole('checkbox', { name: 'Compare executed SQL' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(screen.getByTestId('sql-diff')).toHaveTextContent(
    'SELECT 10SELECT 11',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Swap A/B' }));
  expect(screen.getByTestId('sql-diff')).toHaveTextContent(
    'SELECT 11SELECT 10',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Open Baseline A in new tab' }),
  );
  expect(cloneQueryToNewTab).toHaveBeenCalledWith(executedRuns[1], false);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(
    screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
  ).not.toBeChecked();
  expect(screen.getByTestId('sql-diff')).toHaveTextContent('SELECT 2SELECT 1');
});

test('does not substitute original SQL for missing executed SQL and uses refreshed metadata', async () => {
  const executedRuns = [
    { ...runs[0], executedSql: '' },
    { ...runs[1], executedSql: 'SELECT 20' },
  ];
  const { rerender } = render(
    <QueryComparison queries={executedRuns} displayLimit={100} />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
  );
  expect(screen.getByText('Executed SQL not available')).toBeVisible();
  expect(screen.getByText('SELECT 20')).toBeVisible();
  expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
  expect(screen.queryByText('No SQL changes')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/SQL is too large to diff/),
  ).not.toBeInTheDocument();
  rerender(
    <QueryComparison
      queries={[
        { ...executedRuns[0], executedSql: 'SELECT 10' },
        executedRuns[1],
      ]}
      displayLimit={100}
    />,
  );
  expect(screen.getByTestId('sql-diff')).toHaveTextContent(
    'SELECT 10SELECT 20',
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
  );
  expect(screen.getByTestId('sql-diff')).toHaveTextContent('SELECT 1SELECT 2');
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('does not describe two missing executed SQL values as identical', async () => {
  render(
    <QueryComparison
      queries={runs.map(run => ({ ...run, executedSql: '' }))}
      displayLimit={100}
    />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
  );
  expect(screen.getAllByText('Executed SQL not available')).toHaveLength(2);
  expect(screen.queryByText('No SQL changes')).not.toBeInTheDocument();
  expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
});

test('bounds executed SQL previews using the same limits as original SQL', async () => {
  render(
    <QueryComparison
      queries={[
        { ...runs[0], executedSql: 'x'.repeat(MAX_DIFF_CHARACTERS + 1) },
        { ...runs[1], executedSql: 'SELECT 20' },
      ]}
      displayLimit={100}
    />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
  );
  expect(screen.getByText(/SQL is too large to diff/)).toBeVisible();
  expect(screen.getByText('x'.repeat(MAX_DIFF_CHARACTERS))).toBeVisible();
  expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
});

test.each([
  [QueryState.Started, 'Started'],
  [QueryState.Stopped, 'Stopped'],
  [QueryState.Failed, 'Failed'],
  [QueryState.Pending, 'Pending'],
  [QueryState.Running, 'Running'],
  [QueryState.Scheduled, 'Scheduled'],
  [QueryState.Success, 'Success'],
  [QueryState.Fetching, 'Fetching'],
  [QueryState.TimedOut, 'Timed out'],
  ['unexpected' as QueryState, 'Unknown status'],
  ['' as QueryState, 'Not available'],
])('displays a human-readable label for status %s', async (state, label) => {
  render(
    <QueryComparison
      queries={[{ ...runs[0], state }, runs[1]]}
      displayLimit={100}
    />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  const run = within(screen.getByRole('region', { name: 'Baseline A' }));
  expect(run.getByText('Status').nextElementSibling).toHaveTextContent(label);
});

test.each([
  ['characters', 'x'.repeat(MAX_DIFF_CHARACTERS + 1)],
  ['lines', 'SELECT 1\n'.repeat(MAX_DIFF_LINES + 1)],
])(
  'labels a truncated %s preview even when the other run has no executed SQL',
  async (_, sql) => {
    render(
      <QueryComparison
        queries={[
          { ...runs[0], executedSql: '' },
          { ...runs[1], executedSql: sql },
        ]}
        displayLimit={100}
      />,
    );
    select('a');
    select('b');
    compare();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Compare executed SQL' }),
    );
    expect(screen.getByText('Executed SQL not available')).toBeVisible();
    expect(screen.getByText('Run B preview truncated.')).toBeVisible();
    expect(
      screen.queryByText('Baseline A preview truncated.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/SQL is too large to diff/)).toBeVisible();
    expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Swap A/B' }));
    expect(screen.getByText('Baseline A preview truncated.')).toBeVisible();
    expect(
      screen.queryByText('Run B preview truncated.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Executed SQL not available')).toBeVisible();
  },
);

test('uses a bounded preview rather than diffing large SQL', async () => {
  render(
    <QueryComparison
      queries={[
        { ...runs[0], sql: 'x'.repeat(MAX_DIFF_CHARACTERS + 1) },
        runs[1],
      ]}
      displayLimit={100}
    />,
  );
  select('a');
  select('b');
  compare();
  await waitFor(() =>
    expect(screen.getByText(/SQL is too large to diff/)).toBeVisible(),
  );
  expect(screen.queryByTestId('sql-diff')).not.toBeInTheDocument();
});
