
import { reportBackendError } from '../lib/failureReporter.js';

export function errorHandler(err, req, res, next) {
    console.error('Unhandled error:', err.message);
    reportBackendError(req, err, 500);
    res.locals.failureReported = true; // serverErrorReport must not send a second email for this response
    res.status(500).json({ error: 'Internal server error' });
}
