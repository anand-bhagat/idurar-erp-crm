import { CheckCircleOutlined } from '@ant-design/icons';

/**
 * Format a key for display: snake_case/camelCase -> Title Case.
 */
function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Format a value for display.
 */
function formatValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Detect if this is a CRUD success result (create/update/delete).
 */
function isCrudSuccess(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.deleted === true) return 'deleted';
  if (data._id || data.id) {
    if (data.createdAt && data.updatedAt && data.createdAt === data.updatedAt) return 'created';
    return 'updated';
  }
  return false;
}

/**
 * Detect if data is a stats/summary shape.
 */
function isStatsSummary(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  const statsKeys = ['total', 'count', 'sum', 'avg', 'average', 'min', 'max', 'summary'];
  return keys.some((k) => statsKeys.includes(k.toLowerCase()));
}

/**
 * Hidden keys that shouldn't be displayed in cards/tables.
 */
const HIDDEN_KEYS = ['__v', 'password', 'removed', 'enabled'];

function filterKeys(obj) {
  return Object.keys(obj).filter((k) => !HIDDEN_KEYS.includes(k) && !k.startsWith('_'));
}

/**
 * RecordCard — displays a single record as key-value pairs.
 */
function RecordCard({ data }) {
  const keys = filterKeys(data);
  return (
    <div className="agent-record-card">
      {keys.map((key) => (
        <div key={key} style={{ display: 'contents' }}>
          <div className="agent-record-card-label">{formatKey(key)}</div>
          <div className="agent-record-card-value">{formatValue(data[key])}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * DataTable — displays a list of records as a table.
 */
function DataTable({ rows }) {
  if (!rows.length) return null;
  const columns = filterKeys(rows[0]).slice(0, 6); // Limit columns for readability

  return (
    <div className="agent-data-table-wrapper">
      <table className="agent-data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{formatKey(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col} title={formatValue(row[col])}>
                  {formatValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * StatsSummary — displays aggregate data with large numbers.
 */
function StatsSummary({ data }) {
  const keys = filterKeys(data);
  return (
    <div className="agent-stats-summary">
      {keys.map((key) => (
        <div key={key} className="agent-stats-item">
          <div className="agent-stats-item-value">{formatValue(data[key])}</div>
          <div className="agent-stats-item-label">{formatKey(key)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * ToolResultRenderer — renders tool results based on data shape.
 */
export default function ToolResultRenderer({ result }) {
  if (!result || !result.success) return null;

  const { data, metadata } = result;

  if (!data) return null;

  // Deleted
  if (data.deleted === true) {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body">
          <div className="agent-success-msg">
            <CheckCircleOutlined /> Successfully deleted
          </div>
        </div>
      </div>
    );
  }

  // List of records -> Table
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body">
          <DataTable rows={data} />
        </div>
        {metadata?.totalPages > 1 && (
          <div className="agent-pagination-info">
            Page {metadata.page} of {metadata.totalPages} ({metadata.total} total)
          </div>
        )}
      </div>
    );
  }

  // Empty list
  if (Array.isArray(data) && data.length === 0) {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body" style={{ color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
          No results found.
        </div>
      </div>
    );
  }

  // Stats/summary
  if (isStatsSummary(data)) {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body">
          <StatsSummary data={data} />
        </div>
      </div>
    );
  }

  // CRUD success (single record created/updated)
  const crudAction = isCrudSuccess(data);
  if (crudAction === 'created' || crudAction === 'updated') {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body">
          <div className="agent-success-msg" style={{ marginBottom: 8 }}>
            <CheckCircleOutlined /> Successfully {crudAction}
          </div>
          <RecordCard data={data} />
        </div>
      </div>
    );
  }

  // Single record -> Card
  if (typeof data === 'object' && !Array.isArray(data)) {
    return (
      <div className="agent-tool-result">
        <div className="agent-tool-result-body">
          <RecordCard data={data} />
        </div>
      </div>
    );
  }

  // Fallback -> formatted JSON
  return (
    <div className="agent-tool-result">
      <div className="agent-tool-result-body">
        <pre className="agent-json-fallback">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}
