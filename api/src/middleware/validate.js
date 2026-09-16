// UUID v4 validation middleware — one place instead of reimplementing
// isValidUUID/UUID_REGEX per route file (was previously duplicated ad-hoc
// only in search.js).
//
// Usage:
//   router.get('/:id', validateUUID('id'), handler)                          // req.params.id
//   router.post('/', validateUUID('thread_id', { source: 'body' }), handler) // req.body.thread_id
//   router.post('/download', validateUUID('photo_ids', { source: 'body', isArray: true }), handler) // req.body.photo_ids: string[]
//
// Runs before the route handler, so a bad UUID never reaches a DB query —
// catches it as a clean 400 instead of Postgres throwing a raw invalid
// input syntax error that would otherwise bubble up as a 500.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(str) {
    return typeof str === 'string' && UUID_REGEX.test(str);
}

// fieldName: the param/body key to validate (e.g. 'id', 'threadId', 'thread_id')
// options.source: 'params' (default) or 'body'
// options.required: if false, missing value passes through (only present
//   values are format-checked) — default true, since most uses are route
//   params that always exist by definition.
// options.isArray: if true, fieldName must be a non-empty array and every
//   element must be a valid UUID — for fields like search.js's photo_ids.
//   options.maxItems optionally caps array length (e.g. against an
//   accidental 10,000-item payload) — omit for no cap.
export function validateUUID(fieldName, options = {}) {
    const source = options.source ?? 'params';
    const required = options.required ?? true;
    const isArray = options.isArray ?? false;
    const maxItems = options.maxItems;

    return function (req, res, next) {
        const value = req[source]?.[fieldName];

        const isEmpty = value === undefined || value === null || value === ''
            || (isArray && Array.isArray(value) && value.length === 0);

        if (isEmpty) {
            if (required) {
                return res.status(400).json({ error: `${fieldName} is required` });
            }
            return next();
        }

        if (isArray) {
            if (!Array.isArray(value)) {
                return res.status(400).json({ error: `${fieldName} must be an array` });
            }
            if (maxItems && value.length > maxItems) {
                return res.status(400).json({ error: `${fieldName} must contain at most ${maxItems} items` });
            }
            // Report the first bad one rather than a generic "array is invalid" —
            // matches the single-value error shape below and is easier to debug
            // than silently failing or dropping bad entries.
            const badIndex = value.findIndex((v) => !isValidUUID(v));
            if (badIndex !== -1) {
                return res.status(400).json({
                    error: `${fieldName}[${badIndex}] must be a valid UUID`,
                });
            }
            return next();
        }

        if (!isValidUUID(value)) {
            return res.status(400).json({ error: `${fieldName} must be a valid UUID` });
        }

        next();
    };
}
