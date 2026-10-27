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
import { useState } from 'react';
import { QueryResponse, QueryState } from '@superset-ui/core';
import { Alert } from '@apache-superset/core/components';
import {
  Button,
  Checkbox,
  Col,
  Modal,
  Row,
  Space,
} from '@superset-ui/core/components';
import { t } from '@apache-superset/core/translation';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import QueryTable, { QueryTableProps } from 'src/SqlLab/components/QueryTable';
import { useAppDispatch } from 'src/SqlLab/hooks/useAppDispatch';
import { cloneQueryToNewTab } from 'src/SqlLab/actions/sqlLab';
import {
  canDiffSql,
  compareRuns,
  getDuration,
  getRows,
  previewSql,
} from './utils';

const unavailable = () => t('Not available');
const formatNumber = (value: number | null) =>
  value === null ? unavailable() : value.toFixed(2);
const formatDuration = (value: number | null) =>
  value === null ? unavailable() : t('%s ms', formatNumber(value));

/** Translate known statuses without displaying unrecognized backend values. */
function formatStatus(state: string | undefined): string {
  switch (state) {
    case QueryState.Started:
      return t('Started');
    case QueryState.Stopped:
      return t('Stopped');
    case QueryState.Failed:
      return t('Failed');
    case QueryState.Pending:
      return t('Pending');
    case QueryState.Running:
      return t('Running');
    case QueryState.Scheduled:
      return t('Scheduled');
    case QueryState.Success:
      return t('Success');
    case QueryState.Fetching:
      return t('Fetching');
    case QueryState.TimedOut:
      return t('Timed out');
    default:
      return state ? t('Unknown status') : unavailable();
  }
}

/** Display loaded history with an opt-in, local two-run comparison workflow. */
export default function QueryComparison({
  queries = [],
  columns = ['started', 'duration', 'rows'],
  ...tableProps
}: QueryTableProps) {
  const dispatch = useAppDispatch();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const [showExecutedSql, setShowExecutedSql] = useState(false);
  const selected = selectedIds
    .map(id => queries.find(query => query.id === id))
    .filter((query): query is QueryResponse => Boolean(query));
  const [baseline, comparison] = selected;
  const validPair = selected.length === 2;

  if (selected.length !== selectedIds.length) {
    setSelectedIds(selected.map(query => query.id));
    setShow(false);
  }

  const metrics =
    baseline && comparison ? compareRuns(baseline, comparison) : null;
  const oldSql = showExecutedSql
    ? baseline?.executedSql || null
    : (baseline?.sql ?? '');
  const newSql = showExecutedSql
    ? comparison?.executedSql || null
    : (comparison?.sql ?? '');
  const sqlAvailable = oldSql !== null && newSql !== null;
  const oldSqlTruncated = oldSql !== null && !canDiffSql(oldSql);
  const newSqlTruncated = newSql !== null && !canDiffSql(newSql);
  const boundedDiff = sqlAvailable && !oldSqlTruncated && !newSqlTruncated;

  const renderSelection = (query: QueryResponse) => {
    const index = selectedIds.indexOf(query.id);
    return (
      <Checkbox
        aria-label={t('Select query run %s for comparison', query.id)}
        checked={index >= 0}
        disabled={index < 0 && selected.length >= 2}
        onChange={() =>
          setSelectedIds(ids =>
            ids.includes(query.id)
              ? ids.filter(id => id !== query.id)
              : ids.length < 2
                ? [...ids, query.id]
                : ids,
          )
        }
      >
        {index === 0 ? t('Baseline A') : index === 1 ? t('Run B') : null}
      </Checkbox>
    );
  };

  const renderRun = (query: QueryResponse, label: string) => (
    <section aria-label={label}>
      <h3>{label}</h3>
      <dl>
        <dt>{t('Run')}</dt>
        <dd>{query.id}</dd>
        <dt>{t('Started')}</dt>
        <dd>
          {Number.isFinite(query.startDttm)
            ? extendedDayjs(query.startDttm).format('L HH:mm:ss')
            : unavailable()}
        </dd>
        <dt>{t('Database ID')}</dt>
        <dd>{query.dbId ?? unavailable()}</dd>
        <dt>{t('Status')}</dt>
        <dd>{formatStatus(query.state)}</dd>
        <dt>{t('Duration')}</dt>
        <dd>{formatDuration(getDuration(query))}</dd>
        <dt>{t('Returned rows')}</dt>
        <dd>{getRows(query) ?? unavailable()}</dd>
      </dl>
      <Button
        onClick={() => {
          dispatch(cloneQueryToNewTab(query, false));
          setShow(false);
        }}
      >
        {t('Open %s in new tab', label)}
      </Button>
    </section>
  );

  return (
    <>
      <Space wrap>
        <Button
          disabled={!validPair}
          onClick={() => {
            setShowExecutedSql(false);
            setShow(true);
          }}
        >
          {t('Compare runs')}
        </Button>
        <Button
          disabled={selectedIds.length === 0}
          onClick={() => {
            setSelectedIds([]);
            setShow(false);
          }}
        >
          {t('Clear selection')}
        </Button>
        <output>
          {selected.length === 2
            ? t('Two runs selected. Clear or deselect a run to choose another.')
            : t('Select two runs. The first selection is baseline A.')}
        </output>
      </Space>
      <QueryTable
        {...tableProps}
        queries={queries}
        columns={['comparison', ...columns]}
        renderComparison={renderSelection}
      />
      <Modal
        show={show && validPair}
        onHide={() => setShow(false)}
        title={t('Query-run comparison')}
        name={t('Query-run comparison')}
        width="90%"
        footer={
          <Space>
            <Button onClick={() => setSelectedIds(ids => [...ids].reverse())}>
              {t('Swap A/B')}
            </Button>
            <Button onClick={() => setShow(false)}>{t('Close')}</Button>
          </Space>
        }
      >
        {baseline && comparison && metrics && (
          <>
            <Row gutter={16}>
              <Col span={12}>{renderRun(baseline, t('Baseline A'))}</Col>
              <Col span={12}>{renderRun(comparison, t('Run B'))}</Col>
            </Row>
            {metrics.differentDatabases && (
              <Alert
                type="warning"
                message={t('These runs use different databases.')}
              />
            )}
            <p>
              {t(
                'Duration change (B minus A): %s',
                formatDuration(metrics.durationChange),
              )}
              {' · '}
              {metrics.percentageChange === null
                ? t('Percentage change: Not available')
                : t(
                    'Percentage change: %s%%',
                    formatNumber(metrics.percentageChange),
                  )}
            </p>
            <p>
              {t(
                'Returned row change (B minus A): %s',
                metrics.rowChange ?? unavailable(),
              )}
            </p>
            <Alert
              type="info"
              message={t(
                'Timing differences are observations, not proof of optimization. Caching, database load, and execution conditions affect timings. Row counts may be limited.',
              )}
            />
            <h3>{t('SQL differences')}</h3>
            <Checkbox
              checked={showExecutedSql}
              onChange={event => setShowExecutedSql(event.target.checked)}
            >
              {t('Compare executed SQL')}
            </Checkbox>
            {showExecutedSql && (
              <p>
                {t(
                  'Showing SQL recorded as executed. Opening a run in a new tab still uses the original SQL.',
                )}
              </p>
            )}
            {!sqlAvailable && (
              <Alert
                type="warning"
                message={t(
                  'Executed SQL is unavailable for one or both runs. Switch to original SQL to compare them.',
                )}
              />
            )}
            {sqlAvailable && oldSql === newSql && <p>{t('No SQL changes')}</p>}
            {boundedDiff && oldSql !== newSql ? (
              <ReactDiffViewer
                oldValue={oldSql}
                newValue={newSql}
                splitView
                showDiffOnly={false}
                leftTitle={t('Baseline A — removed lines (-)')}
                rightTitle={t('Run B — added lines (+)')}
              />
            ) : (
              <>
                {(oldSqlTruncated || newSqlTruncated) && (
                  <p>
                    {t(
                      'SQL is too large to diff. Showing bounded previews; SQL has not been modified.',
                    )}
                  </p>
                )}
                <Row gutter={16}>
                  <Col span={12}>
                    <h4>{t('Baseline A')}</h4>
                    {oldSqlTruncated && (
                      <p>{t('%s preview truncated.', t('Baseline A'))}</p>
                    )}
                    <pre>
                      {oldSql === null
                        ? t('Executed SQL not available')
                        : previewSql(oldSql) || t('Empty SQL')}
                    </pre>
                  </Col>
                  <Col span={12}>
                    <h4>{t('Run B')}</h4>
                    {newSqlTruncated && (
                      <p>{t('%s preview truncated.', t('Run B'))}</p>
                    )}
                    <pre>
                      {newSql === null
                        ? t('Executed SQL not available')
                        : previewSql(newSql) || t('Empty SQL')}
                    </pre>
                  </Col>
                </Row>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
