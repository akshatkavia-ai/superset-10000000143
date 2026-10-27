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
import { QueryResponse, concludedQueryStateList } from '@superset-ui/core';

export const MAX_DIFF_CHARACTERS = 20000;
export const MAX_DIFF_LINES = 500;

/** Return elapsed milliseconds only for completed runs with valid timestamps. */
export function getDuration(query: Partial<QueryResponse>): number | null {
  const { startDttm, endDttm, state } = query;
  if (
    !state ||
    !concludedQueryStateList.includes(state) ||
    typeof startDttm !== 'number' ||
    typeof endDttm !== 'number' ||
    !Number.isFinite(startDttm) ||
    !Number.isFinite(endDttm) ||
    endDttm < startDttm
  ) {
    return null;
  }
  return endDttm - startDttm;
}

/** Preserve unavailable counts rather than treating them as zero. */
export function getRows(query: Partial<QueryResponse>): number | null {
  return typeof query.rows === 'number' &&
    Number.isFinite(query.rows) &&
    query.rows >= 0
    ? query.rows
    : null;
}

/** Compare observed metadata, with B minus A as the direction of change. */
export function compareRuns(
  baseline: Partial<QueryResponse>,
  comparison: Partial<QueryResponse>,
) {
  const baselineDuration = getDuration(baseline);
  const comparisonDuration = getDuration(comparison);
  const durationChange =
    baselineDuration === null || comparisonDuration === null
      ? null
      : comparisonDuration - baselineDuration;
  const baselineRows = getRows(baseline);
  const comparisonRows = getRows(comparison);
  return {
    baselineDuration,
    comparisonDuration,
    durationChange,
    percentageChange:
      durationChange !== null &&
      baselineDuration !== null &&
      baselineDuration > 0
        ? (durationChange / baselineDuration) * 100
        : null,
    rowChange:
      baselineRows === null || comparisonRows === null
        ? null
        : comparisonRows - baselineRows,
    differentDatabases:
      baseline.dbId != null &&
      comparison.dbId != null &&
      baseline.dbId !== comparison.dbId,
  };
}

/** Bound both diff computation and rendered line count. */
export function canDiffSql(sql: string): boolean {
  return (
    sql.length <= MAX_DIFF_CHARACTERS &&
    sql.split('\n', MAX_DIFF_LINES + 1).length <= MAX_DIFF_LINES
  );
}

/** Limit the fallback preview without modifying the original query. */
export function previewSql(sql: string): string {
  return sql
    .slice(0, MAX_DIFF_CHARACTERS)
    .split('\n', MAX_DIFF_LINES)
    .join('\n');
}
