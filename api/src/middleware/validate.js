const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(str) {
    return typeof str === 'string' && UUID_REGEX.test(str);
}

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
