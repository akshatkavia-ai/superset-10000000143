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
import { QueryState } from '@superset-ui/core';
import {
  canDiffSql,
  compareRuns,
  getDuration,
  getRows,
  MAX_DIFF_CHARACTERS,
  MAX_DIFF_LINES,
  previewSql,
} from './utils';

const run = {
  state: QueryState.Success,
  startDttm: 1000,
  endDttm: 1100,
  rows: 10,
  dbId: 1,
};

test.each([
  [1100, 0, 0],
  [1200, 100, 100],
  [1050, -50, -50],
])(
  'compares end time %s in the B minus A direction',
  (endDttm, delta, percent) => {
    expect(compareRuns(run, { ...run, endDttm })).toMatchObject({
      durationChange: delta,
      percentageChange: percent,
      rowChange: 0,
      differentDatabases: false,
    });
  },
);

test('does not divide by a zero-duration baseline', () => {
  expect(compareRuns({ ...run, endDttm: 1000 }, run)).toMatchObject({
    baselineDuration: 0,
    durationChange: 100,
    percentageChange: null,
  });
});

test.each([
  { startDttm: undefined },
  { endDttm: undefined },
  { startDttm: NaN },
  { endDttm: Infinity },
  { endDttm: 999 },
  { state: QueryState.Running },
  { state: QueryState.Pending },
])('rejects unavailable duration: %p', overrides => {
  expect(getDuration({ ...run, ...overrides })).toBeNull();
  expect(compareRuns(run, { ...run, ...overrides }).durationChange).toBeNull();
});

test.each([QueryState.Failed, QueryState.Stopped, QueryState.TimedOut])(
  'allows completed state %s with valid timing',
  state => expect(getDuration({ ...run, state })).toBe(100),
);

test('preserves missing row counts and detects database mismatch', () => {
  expect(getRows({ rows: 0 })).toBe(0);
  expect(getRows({})).toBeNull();
  expect(getRows({ rows: -1 })).toBeNull();
  expect(getRows({ rows: NaN })).toBeNull();
  expect(compareRuns(run, { dbId: 2 })).toMatchObject({
    rowChange: null,
    differentDatabases: true,
    percentageChange: null,
  });
  expect(compareRuns(run, { ...run, rows: 15 }).rowChange).toBe(5);
});

test('bounds SQL diff by characters and line count without rewriting input', () => {
  expect(canDiffSql('')).toBe(true);
  expect(canDiffSql('SELECT 1\nSELECT 2')).toBe(true);
  const longSql = 'x'.repeat(MAX_DIFF_CHARACTERS + 1);
  const manyLines = '\n'.repeat(MAX_DIFF_LINES + 1);
  expect(canDiffSql(longSql)).toBe(false);
  expect(canDiffSql(manyLines)).toBe(false);
  expect(previewSql(longSql)).toHaveLength(MAX_DIFF_CHARACTERS);
  expect(previewSql(manyLines).split('\n')).toHaveLength(MAX_DIFF_LINES);
  expect(longSql).toHaveLength(MAX_DIFF_CHARACTERS + 1);
});
