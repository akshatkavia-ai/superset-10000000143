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

import { test as base, expect, Request } from '@playwright/test';
import { SqlLabPage } from '../../pages/SqlLabPage';
import { waitForPost } from '../../helpers/api/intercepts';
import { expectStatus } from '../../helpers/api/assertions';
import { TIMEOUT } from '../../utils/constants';

const BASELINE_SQL = 'SELECT 1 AS comparison_a';
const RUN_B_SQL = 'SELECT 2 AS comparison_b';

interface ComparisonFixture {
  sqlLab: SqlLabPage;
  runIds: string[];
  unexpectedExecutions: string[];
}

// The chromium-sqllab project serializes tests because tab state is per user.
// Use fresh tabs and actual executions, not mocked Redux state or diff output.
const test = base.extend<{ comparison: ComparisonFixture }>({
  comparison: async ({ page }, runTest) => {
    const sqlLab = new SqlLabPage(page);
    await sqlLab.gotoAndReady();
    const initialTabCount = await sqlLab.getTabCount();
    const unexpectedExecutions: string[] = [];
    const recordExecution = (request: Request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.endsWith('/api/v1/sqllab/execute/')
      ) {
        unexpectedExecutions.push(request.url());
      }
    };

    try {
      const tabCreated = waitForPost(page, /tabstateview\/?$/, {
        timeout: TIMEOUT.API_RESPONSE,
      });
      await sqlLab.addTab();
      await sqlLab.editor.waitForReady();
      await tabCreated;
      await sqlLab.selectDatabase('examples');

      const runIds: string[] = [];
      for (const [sql, header] of [
        [BASELINE_SQL, 'comparison_a'],
        [RUN_B_SQL, 'comparison_b'],
      ]) {
        const response = await sqlLab.executeQuery(sql);
        expectStatus(response, 200);
        const payload: { client_id: string } = response
          .request()
          .postDataJSON();
        expect(typeof payload.client_id).toBe('string');
        runIds.push(payload.client_id);
        await sqlLab.waitForQueryResults(header);
      }

      await sqlLab.resultsPane
        .getByRole('tab', { name: 'Query history', exact: true })
        .click();
      for (const id of runIds) {
        await expect(
          sqlLab.resultsPane.getByRole('checkbox', {
            name: `Select query run ${id} for comparison`,
            exact: true,
          }),
        ).toBeEnabled();
      }

      page.on('request', recordExecution);
      await runTest({ sqlLab, runIds, unexpectedExecutions });
    } finally {
      page.off('request', recordExecution);
      const dialog = page.getByRole('dialog', {
        name: 'Query-run comparison',
        exact: true,
      });
      if (await dialog.isVisible()) {
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await expect(dialog).toBeHidden();
      }
      // Remove both the fixture tab and any cloned tab on assertion failure.
      while ((await sqlLab.getTabCount()) > initialTabCount) {
        await sqlLab.closeLastTab();
      }
    }
  },
});

test.beforeEach(() => {
  test.setTimeout(TIMEOUT.SLOW_TEST * 2);
});

test('renders the real split SQL diff and swaps baseline and run B', async ({
  page,
  comparison,
}) => {
  const { sqlLab, runIds, unexpectedExecutions } = comparison;
  for (const id of runIds) {
    await sqlLab.resultsPane
      .getByRole('checkbox', {
        name: `Select query run ${id} for comparison`,
        exact: true,
      })
      .check();
  }
  await sqlLab.resultsPane
    .getByRole('button', { name: 'Compare runs', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Query-run comparison',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Baseline A — removed lines (-)', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Run B — added lines (+)', { exact: true }),
  ).toBeVisible();

  // Actual split-view table cells: word diffs may wrap characters in spans.
  const oldSql = dialog.locator('td.left');
  const newSql = dialog.locator('td.right');
  await expect(oldSql).toHaveText(BASELINE_SQL);
  await expect(newSql).toHaveText(RUN_B_SQL);
  await expect(
    dialog.getByRole('region', { name: 'Baseline A', exact: true }),
  ).toContainText(runIds[0]);
  await expect(
    dialog.getByRole('region', { name: 'Run B', exact: true }),
  ).toContainText(runIds[1]);

  const leftBounds = await oldSql.boundingBox();
  const rightBounds = await newSql.boundingBox();
  expect(leftBounds).not.toBeNull();
  expect(rightBounds).not.toBeNull();
  expect(leftBounds!.x + leftBounds!.width).toBeLessThanOrEqual(rightBounds!.x);

  await dialog.getByRole('button', { name: 'Swap A/B', exact: true }).click();
  await expect(oldSql).toHaveText(RUN_B_SQL);
  await expect(newSql).toHaveText(BASELINE_SQL);
  await expect(
    dialog.getByRole('region', { name: 'Baseline A', exact: true }),
  ).toContainText(runIds[1]);
  await expect(
    dialog.getByRole('region', { name: 'Run B', exact: true }),
  ).toContainText(runIds[0]);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(unexpectedExecutions).toEqual([]);
});

test('selects runs with Space and restores focus after keyboard dismissal', async ({
  page,
  comparison,
}) => {
  const { sqlLab, runIds, unexpectedExecutions } = comparison;
  const compare = sqlLab.resultsPane.getByRole('button', {
    name: 'Compare runs',
    exact: true,
  });
  await expect(compare).toBeDisabled();
  for (const [index, id] of runIds.entries()) {
    const checkbox = sqlLab.resultsPane.getByRole('checkbox', {
      name: `Select query run ${id} for comparison`,
      exact: true,
    });
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    if (index === 0) {
      await expect(compare).toBeDisabled();
    }
  }
  await expect(compare).toBeEnabled();
  await compare.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Query-run comparison',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      dialog.evaluate(element => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(compare).toBeFocused();

  await sqlLab.resultsPane
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  for (const id of runIds) {
    await expect(
      sqlLab.resultsPane.getByRole('checkbox', {
        name: `Select query run ${id} for comparison`,
        exact: true,
      }),
    ).not.toBeChecked();
  }
  await expect(compare).toBeDisabled();
  expect(unexpectedExecutions).toEqual([]);
});

test('opens original SQL in a new tab without executing it', async ({
  page,
  comparison,
}) => {
  const { sqlLab, runIds, unexpectedExecutions } = comparison;
  for (const id of runIds) {
    await sqlLab.resultsPane
      .getByRole('checkbox', {
        name: `Select query run ${id} for comparison`,
        exact: true,
      })
      .check();
  }
  await sqlLab.resultsPane
    .getByRole('button', { name: 'Compare runs', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Query-run comparison',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('checkbox', { name: 'Compare executed SQL', exact: true })
    .check();
  await expect(
    dialog.getByText(
      'Showing SQL recorded as executed. Opening a run in a new tab still uses the original SQL.',
      { exact: true },
    ),
  ).toBeVisible();

  const tabCount = await sqlLab.getTabCount();
  const tabCreated = waitForPost(page, /tabstateview\/?$/, {
    timeout: TIMEOUT.API_RESPONSE,
  });
  await dialog
    .getByRole('button', { name: 'Open Baseline A in new tab', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await sqlLab.editor.waitForReady();
  await expect.poll(() => sqlLab.getTabCount()).toBe(tabCount + 1);
  await expect.poll(() => sqlLab.getQuery()).toBe(BASELINE_SQL);
  await expect(sqlLab.runQueryButton.element).toBeEnabled();

  // Persistence is an observable lifecycle barrier, not an arbitrary sleep:
  // the cloned editor has mounted and its autorun effects have run by then.
  await tabCreated;
  expect(unexpectedExecutions).toEqual([]);
});
