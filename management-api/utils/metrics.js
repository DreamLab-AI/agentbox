// R-011: consolidated onto observability/metrics.js (single Prometheus registry,
// single collectDefaultMetrics call). This file is retained as a thin re-export
// so any straggler `require('./utils/metrics')` still resolves to the canonical
// registry instead of constructing a second one. Do not add metrics here.
module.exports = require('../observability/metrics');
